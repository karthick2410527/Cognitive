// Free-form written questions. The model writes multiple-choice questions for one domain at a
// difficulty label and picks the question format itself (the product's own item-writer prompt,
// FREEFORM_TEMPLATE, used verbatim). Because no rule-based solver can check a free-form question, a
// second, independent call answers each question without seeing the key; only questions where it
// agrees and finds exactly one defensible answer go on to the usual gates (structural, bias,
// duplicate) and into the bank, where later sessions reuse them before anything new is written.
//
// The model's self-reported psychometrics are kept in provenance for reference only: difficulty is
// set by the engine from the requested level (the lever policy), never by the model.
import { z } from 'zod';
import type { LoadedPlugin, LoadedTaskType, RawItem } from '@cognimetric/core';
import { config, isProd } from '../config';
import { q } from '../db/pool';
import { resolveLevers } from '../engine/levers';
import { estimateB } from '../engine/params';
import { markDegraded } from '../llm';
import { ProviderError, type LlmProvider } from '../llm/provider';
import { probationRemaining } from '../prompts/governance';
import { servicesFor } from '../services/lexicon';
import { generationConfig } from '../live/config';
import { createRng } from '@cognimetric/core';
import { log, seed32, sha256 } from '../util';
import { processCandidate } from '../validation/pipeline';
import type { JobResult } from './service';

export const FREEFORM_VERSION = 'freeform/1.0.0';
export const VERIFY_VERSION = 'freeform_verify/1.0.0';

export interface FreeformArgs {
  count: number;
  optionsPerQuestion: number;
  domain: { id: string; name: string };
  difficultyValue: number;
  difficultyLabel: 'easy' | 'medium' | 'hard';
  defaultTimeLimitSeconds: number;
  avoidPrompts: string[];
}

/** The item-writer prompt, verbatim. */
export function freeformPrompt({ count, optionsPerQuestion, domain, difficultyValue, difficultyLabel, defaultTimeLimitSeconds, avoidPrompts }: FreeformArgs): { system: string; user: string } {
  const system = `You are an item-writer for a cognitive assessment engine ("Cognimetric").
You generate multiple-choice cognitive test items for a single domain at a given difficulty.
You MUST respond with ONLY a JSON array (no markdown fences, no prose, no commentary) of exactly ${count} item object(s).

Each item object must match this exact shape (do not include an id or domain field — the server assigns those):
{
  "task_type": string (short snake_case task name, e.g. "delayed_recall_recognition"),
  "prompt": string (the question text shown to the test-taker; self-contained, does not depend on external images),
  "options": string[] (exactly ${optionsPerQuestion} plausible options, only one correct),
  "correct_answer": number (0-based index into options of the single correct answer),
  "psychometrics": {
    "model": "prototype_mirt_2pl",
    "discrimination": number[] (one float per domain dimension, mostly 0, one non-zero for "${domain.id}"),
    "difficulty": number (should be close to ${difficultyValue})
  },
  "accessibility": {
    "speech_required": boolean,
    "vision_required": boolean,
    "motor_demand": "low" | "medium" | "high",
    "literacy_required": boolean,
    "modality": "visual" | "auditory" | "text"
  },
  "response_type": "choice",
  "time_limit_seconds": number (reasonable for the task, default around ${defaultTimeLimitSeconds}),
  "difficulty_label": "${difficultyLabel}",
  "content_tags": string[] (2-4 short tags)
}

Rules:
- Items must be answerable from the prompt text alone (no actual images exist — describe scenarios in words).
- Vary task_type across items when count > 1.
- Keep prompts concise and unambiguous, with exactly one defensible correct answer.
- Calibrate genuine difficulty to the "${difficultyLabel}" label: easy items should be quick and low-load, hard items should require holding more information, resisting interference, or working under time pressure.
- Do not reuse any of these existing prompts (write clearly different items): ${avoidPrompts.length ? avoidPrompts.map((p) => `"${p}"`).join(", ") : "(none yet)"}
- Output raw JSON only, starting with [ and ending with ].`;

  const user = `Generate ${count} item(s) for domain "${domain.name}" (id: "${domain.id}") at difficulty label "${difficultyLabel}" (target numeric difficulty ${difficultyValue}).`;

  return { system, user };
}

/** The independent check: answer each question without the key. */
export const VERIFY_SYSTEM = `You check multiple-choice questions written for a cognitive assessment.
For each question, work it out yourself from the question text and options alone, then report which
option is correct. Say whether exactly one option is defensible: false if two or more options could be
argued correct, if none is correct, if the question needs information it does not give, or if it is
ambiguous. Respond with ONLY a JSON array, one object per question, in the same order:
[{"answer_index": number (0-based), "exactly_one_defensible": boolean, "problem": string or null}]`;

export function verifyRequest(items: { prompt: string; options: string[] }[]): string {
  return items.map((it, i) => [`QUESTION ${i + 1}`, it.prompt, ...it.options.map((o, j) => `  ${j}: ${o}`)].join('\n')).join('\n\n');
}

/** Registered in prompt_versions at boot (nothing reaches a model that is not in that table). */
export const FREEFORM_TEMPLATE_BODY = freeformPrompt({ count: 0, optionsPerQuestion: 0, domain: { id: '{domain.id}', name: '{domain.name}' }, difficultyValue: 0, difficultyLabel: 'medium', defaultTimeLimitSeconds: 0, avoidPrompts: [] }).system
  .replace(/exactly 0 item/, 'exactly {count} item').replace(/exactly 0 plausible/, 'exactly {optionsPerQuestion} plausible');

const ModelItem = z.object({
  task_type: z.string().min(1).max(60),
  prompt: z.string().min(5).max(1200),
  options: z.array(z.string().min(1).max(300)),
  correct_answer: z.number().int().min(0),
  psychometrics: z.unknown().optional(),
  accessibility: z.unknown().optional(),
  response_type: z.string().optional(),
  time_limit_seconds: z.number().optional(),
  difficulty_label: z.string().optional(),
  content_tags: z.array(z.string()).optional(),
});
type ModelItem = z.infer<typeof ModelItem>;
const Verdict = z.object({ answer_index: z.number().int(), exactly_one_defensible: z.boolean(), problem: z.string().nullable().optional() });

export const labelFor = (b: number): FreeformArgs['difficultyLabel'] => (b <= -0.75 ? 'easy' : b >= 0.75 ? 'hard' : 'medium');
const snake = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'question';

/** The item shape the engine stores, from one model item and its check. */
export function toRawItem(tt: LoadedTaskType, it: ModelItem, levers: Record<string, unknown>, check: z.infer<typeof Verdict> | null): RawItem & { freeform_check: unknown } {
  return {
    task_type: tt.def.id,
    blueprint: { phases: [{ phase: 'present', stem: it.prompt.trim(), options: it.options.map((o) => o.trim()), format: snake(it.task_type) }] },
    answer_key: { kind: 'index', value: it.correct_answer },
    rationale: check ? `An independent check chose option ${check.answer_index} and found ${check.exactly_one_defensible ? 'exactly one' : 'more or less than one'} defensible answer.` : 'Not checked.',
    lever_realisation: { ...levers },
    lever_conflict: null,
    content_tags: (it.content_tags ?? []).slice(0, 4).map(snake),
    text_alternative: null,
    freeform_check: check,
  } as never;
}

/** Procedural stand-in for the local provider (tests, no API key): converts typed written items. */
function localItems(plugin: LoadedPlugin, count: number, n: number, levers: Record<string, unknown>, targetB: number, seed: number): ModelItem[] {
  const out: ModelItem[] = [];
  const typed = [...plugin.taskTypes.values()].filter((t) => t.def.protocol === 'single' && t.def.generation !== 'freeform' && t.def.modalities.includes('text') && t.author);
  const services = servicesFor(plugin.manifest.bank.locales[0]!, plugin.manifest.requires_services);
  for (let k = 0; out.length < count && k < count * 6 && typed.length; k++) {
    const t = typed[k % typed.length]!;
    const lv = resolveLevers(plugin.manifest, t.def, targetB, createRng(seed + k));
    const [it] = t.author!({ taskType: t.def, modality: 'text', levers: lv, count: 1, seed: seed + k * 13, locale: 'en', readingLevel: plugin.manifest.prompt.reading_level, exclusionSignatures: [] }, services);
    const p = it?.blueprint.phases[0];
    if (!it || it.lever_conflict || !p?.options || p.options.length !== n || it.answer_key.kind !== 'index') continue;
    const prompt = [p.instruction_text, p.stem, (p as { display?: string }).display].filter(Boolean).join('\n');
    out.push({ task_type: t.def.id, prompt, options: p.options, correct_answer: it.answer_key.value, content_tags: it.content_tags, time_limit_seconds: Number(levers.time_limit_ms ?? 30000) / 1000 });
  }
  return out;
}

async function avoidList(pluginId: string, taskType: string, sessionId: string | null | undefined): Promise<string[]> {
  const rows = await q<{ stem: string }>(
    `SELECT blueprint->'phases'->0->>'stem' AS stem FROM items WHERE plugin_id=$1 AND task_type=$2 AND status <> 'retired'
     ORDER BY created_at DESC LIMIT 25`, [pluginId, taskType]);
  return rows.map((r) => r.stem.replace(/\s+/g, ' ').slice(0, 90)).filter(Boolean);
}

export interface FreeformJob { job_id: string; kind: string; plugin_id: string; task_type: string; locale: string; target_b: number; requested: number; session_id?: string | null }

export async function runFreeformJob(job: FreeformJob, plugin: LoadedPlugin, tt: LoadedTaskType, band: number, provider: LlmProvider, result: JobResult, finish: (state: string, error?: string) => Promise<void>): Promise<JobResult> {
  const m = plugin.manifest;
  const cfg = generationConfig().written;
  const n = cfg.options_per_question;
  const count = Math.max(job.requested, cfg.per_call);
  const seed = seed32();
  const levers = resolveLevers(m, tt.def, job.target_b, createRng(seed));
  const label = labelFor(job.target_b);
  const promptVersion = `${FREEFORM_VERSION}#${sha256(FREEFORM_TEMPLATE_BODY).slice(0, 8)}`;
  const probation = (await probationRemaining(promptVersion, config.PROBATION_ITEMS)) > 0 && isProd();
  await q('UPDATE generation_jobs SET prompt_version=$2, model=$3, provider=$4 WHERE job_id=$1', [job.job_id, promptVersion, provider.model, provider.id]);
  const args: FreeformArgs = {
    count, optionsPerQuestion: n, domain: { id: m.plugin_id, name: m.name }, difficultyValue: Math.round(job.target_b * 100) / 100, difficultyLabel: label,
    defaultTimeLimitSeconds: Math.round(Number(levers.time_limit_ms ?? 30000) / 1000), avoidPrompts: await avoidList(m.plugin_id, tt.def.id, job.session_id),
  };

  // A provider call with the same retry rule as the layered path: transient errors (503 "high demand",
  // a per-minute limit) wait and retry, up to 3 attempts; a quota that resets in hours does not.
  const priority: 'live' | 'background' = job.kind === 'live' || job.kind === 'live_fallback' ? 'live' : 'background';
  const call = async (req: Omit<Parameters<LlmProvider['generate']>[0], 'priority'>) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await provider.generate({ ...req, priority });
      } catch (e) {
        const pe = e as ProviderError;
        const longQuota = pe.kind === 'quota' && (pe.retryAfterMs ?? 0) > 120_000;
        if (!pe.retryable || longQuota || attempt >= 3) throw e;
        log('W1', `freeform provider error (${pe.kind}), retrying: ${pe.message.slice(0, 120)}`);
        await new Promise((r) => setTimeout(r, Math.min(pe.retryAfterMs ?? 1000 * 2 ** attempt, 30_000)));
      }
    }
  };

  // 1. Write.
  let items: ModelItem[] = [];
  let verdicts: (z.infer<typeof Verdict> | null)[] = [];
  let modelId = provider.model;
  try {
    if (provider.id === 'local') {
      items = localItems(plugin, count, n, levers, job.target_b, seed);
      verdicts = items.map((it) => ({ answer_index: it.correct_answer, exactly_one_defensible: true, problem: null }));
    } else {
      const { system, user } = freeformPrompt(args);
      const res = await call({ prefix: { text: system, hash: sha256(system) }, request: user, schema: null, maxOutputTokens: 900 * count, thinking: m.prompt.thinking, seed, timeoutMs: 90_000 });
      result.costUsd += res.costUsd;
      modelId = res.modelId;
      const arr = Array.isArray(res.json) ? res.json : ((res.json as { items?: unknown[] })?.items ?? []);
      for (const raw of arr) {
        const p = ModelItem.safeParse(raw);
        if (!p.success) { result.rejected++; result.reasons['freeform:malformed_item'] = (result.reasons['freeform:malformed_item'] ?? 0) + 1; continue; }
        if (p.data.options.length !== n || p.data.correct_answer >= p.data.options.length) { result.rejected++; result.reasons['freeform:option_count'] = (result.reasons['freeform:option_count'] ?? 0) + 1; continue; }
        items.push(p.data);
      }
      // 2. Check every answer key with one independent call (the key is not sent).
      verdicts = items.map(() => null);
      if (items.length && cfg.verify) {
        const v = await call({ prefix: { text: VERIFY_SYSTEM, hash: sha256(VERIFY_SYSTEM) }, request: verifyRequest(items), schema: null, maxOutputTokens: 300 * items.length + 2048, thinking: 'medium', seed: seed + 1, timeoutMs: 90_000 });
        result.costUsd += v.costUsd;
        const varr = Array.isArray(v.json) ? v.json : [];
        verdicts = items.map((_, i) => { const p = Verdict.safeParse(varr[i]); return p.success ? p.data : null; });
      }
    }
  } catch (e) {
    const pe = e as ProviderError;
    result.reasons[`provider_${pe.kind ?? 'error'}`] = (result.reasons[`provider_${pe.kind ?? 'error'}`] ?? 0) + 1;
    log('W1', `freeform provider error (${pe.kind}): ${pe.message.slice(0, 160)}`);
    if (pe.kind === 'auth' || pe.kind === 'not_found') markDegraded(pe.message);
    if (pe.kind === 'quota' && (pe.retryAfterMs ?? 0) > 120_000) markDegraded(`quota exhausted until ${new Date(Date.now() + pe.retryAfterMs!).toISOString()}: ${pe.message}`, Date.now() + pe.retryAfterMs!);
    await finish('failed', pe.message);
    return result;
  }

  // 3. The usual gates and the bank. The plugin's freeform solver reads the independent check.
  const services = servicesFor(job.locale, m.requires_services);
  const b = await estimateB(m.plugin_id, tt.def.id, job.locale, levers, job.target_b);
  const batchHashes = new Set<string>();
  for (const [i, it] of items.entries()) {
    if (cfg.verify && !verdicts[i]) { result.rejected++; result.reasons['solver:unchecked'] = (result.reasons['solver:unchecked'] ?? 0) + 1; continue; }
    const raw = toRawItem(tt, it, levers, verdicts[i] ?? { answer_index: it.correct_answer, exactly_one_defensible: true, problem: null });
    const outcome = await processCandidate(raw, {
      plugin, tt, levers, locale: job.locale, targetB: job.target_b, band, b, seed: (seed * 31 + i) >>> 0, jobId: job.job_id,
      promptVersion, services, probation, batchHashes, modality: 'text',
      provenance: {
        job_id: job.job_id, plugin_version: m.version,
        generator: { prompt_version: promptVersion, model: modelId, provider: provider.id, verify_prompt: VERIFY_VERSION },
        model_reported: { task_type: it.task_type, psychometrics: it.psychometrics ?? null, accessibility: it.accessibility ?? null, time_limit_seconds: it.time_limit_seconds ?? null, difficulty_label: it.difficulty_label ?? null },
        freeform_check: verdicts[i],
      },
    });
    result.outcomes.push(outcome);
    if (outcome.status === 'rejected' || outcome.status === 'quarantined') {
      result.rejected++;
      const k = outcome.status === 'rejected' ? `${outcome.gate}:${outcome.reason}` : `bias:quarantine_${outcome.reason}`;
      result.reasons[k] = (result.reasons[k] ?? 0) + 1;
    } else {
      result.accepted++;
      if (outcome.live) result.live++;
      result.items.push({ item_id: outcome.item_id, live: outcome.live });
    }
  }
  await finish('done');
  return result;
}
