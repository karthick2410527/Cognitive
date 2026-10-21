// W1 generation service: build the 4-layer prompt, call the model, retry only the shortfall,
// classify errors before retrying, send one repair turn for structural failures, and hand every
// candidate to the W2 pipeline. Each job writes tokens, cost, latency and a reject histogram.
import { GENERATION_JSON_SCHEMA, GenerationResponseSchema, createRng, type GateIssue, type LoadedPlugin, type LoadedTaskType } from '@cognimetric/core';
import { config, isProd } from '../config';
import { audit, q, q1 } from '../db/pool';
import { bandOf, resolveLevers } from '../engine/levers';
import { getProvider, markDegraded, providerDegraded } from '../llm';
import { ProviderError } from '../llm/provider';
import { assemblePrefix } from '../prompts/assembler';
import { probationRemaining } from '../prompts/governance';
import { buildL2 } from '../prompts/l2';
import { registry } from '../plugins/registry';
import { servicesFor } from '../services/lexicon';
import { log, seed32, uuid } from '../util';
import { processCandidate, type Outcome } from '../validation/pipeline';
import { estimateB } from '../engine/params';
import { runFreeformJob } from './freeform';

export type JobKind = 'bank_topup' | 'speculative' | 'live_fallback' | 'reseed' | 'shadow' | 'live';

export interface JobSpec { kind: JobKind; pluginId: string; taskType: string; locale: string; targetB: number; requested: number; modality?: 'text' | 'visual'; sessionId?: string }

const ITEM_TOKENS: Record<string, number> = { single: 500, encode_delay_retrieve: 900, timed_block: 600, cross_session: 300, dual_task: 700 };

export async function enqueueJob(spec: JobSpec): Promise<string | null> {
  const { plugin } = registry().taskTypes.get(spec.taskType) ?? {};
  if (!plugin) return null;
  const band = bandOf(spec.targetB, plugin.manifest.bank.b_band_width);
  // Live jobs belong to one session: several may run for the same cell at once.
  const open = spec.kind === 'live' ? null : await q1('SELECT 1 FROM generation_jobs WHERE plugin_id=$1 AND task_type=$2 AND locale=$3 AND b_band=$4 AND (state = \'queued\' OR (state = \'running\' AND started_at > now() - interval \'10 minutes\')) AND kind=$5', [spec.pluginId, spec.taskType, spec.locale, band, spec.kind]);
  if (open) return null;
  const id = uuid();
  const p = getProvider();
  await q('INSERT INTO generation_jobs (job_id, kind, plugin_id, task_type, locale, target_b, b_band, requested, prompt_version, model, provider, modality, session_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [id, spec.kind, spec.pluginId, spec.taskType, spec.locale, spec.targetB, band, spec.requested, 'pending', p.model, p.id, spec.modality ?? null, spec.sessionId ?? null]);
  return id;
}

/** Atomically claims the next queued job (FOR UPDATE SKIP LOCKED — safe with several workers). */
export async function claimJob(kinds?: JobKind[]): Promise<Record<string, unknown> | undefined> {
  return q1(
    `UPDATE generation_jobs SET state='running', started_at=now(), attempts=attempts+1
     WHERE job_id = (SELECT job_id FROM generation_jobs WHERE state='queued' ${kinds ? 'AND kind = ANY($1)' : ''}
                     ORDER BY CASE kind WHEN 'live_fallback' THEN 0 WHEN 'speculative' THEN 1 ELSE 2 END, created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING *`,
    kinds ? [kinds] : [],
  );
}

export async function spendToday(): Promise<number> {
  const r = await q1<{ s: number }>("SELECT coalesce(sum(cost_usd),0)::float AS s FROM generation_jobs WHERE created_at > date_trunc('day', now())");
  return r?.s ?? 0;
}

async function breakerTripped(pluginId: string, taskType: string, locale: string, band: number) {
  const r = await q1<{ tripped_at: Date | null }>('SELECT tripped_at FROM cell_breakers WHERE plugin_id=$1 AND task_type=$2 AND locale=$3 AND b_band=$4', [pluginId, taskType, locale, band]);
  return !!r?.tripped_at;
}

async function updateBreaker(pluginId: string, taskType: string, locale: string, band: number) {
  const last = await q<{ requested: number; accepted: number; rejected: number; reject_reasons: Record<string, number> }>(
    "SELECT requested, accepted, rejected, reject_reasons FROM generation_jobs WHERE plugin_id=$1 AND task_type=$2 AND locale=$3 AND b_band=$4 AND state='done' AND kind <> 'shadow' ORDER BY finished_at DESC LIMIT 3",
    [pluginId, taskType, locale, band],
  );
  if (last.length < 3) return;
  const bad = last.every((j) => j.accepted + j.rejected > 0 && j.rejected / (j.accepted + j.rejected) > 0.6);
  if (!bad) return;
  const hist: Record<string, number> = {};
  for (const j of last) for (const [k, v] of Object.entries(j.reject_reasons)) hist[k] = (hist[k] ?? 0) + v;
  await q(
    `INSERT INTO cell_breakers (plugin_id, task_type, locale, b_band, tripped_at, histogram) VALUES ($1,$2,$3,$4,now(),$5)
     ON CONFLICT (plugin_id, task_type, locale, b_band) DO UPDATE SET tripped_at=now(), histogram=$5`,
    [pluginId, taskType, locale, band, hist],
  );
  await audit('W1', 'circuit_breaker_tripped', 'cell', `${pluginId}/${taskType}/${locale}/${band}`, hist);
  log('W1', `circuit breaker tripped for ${pluginId}/${taskType}/${locale}/b=${band}`, hist);
}

function repairPrompt(issues: GateIssue[], item: unknown): string {
  return [
    'The item below failed validation. Return a corrected version of this item',
    'only, as a single-element "items" array. Change nothing except what the',
    'errors require. Preserve the stimulus content, the rule and the keyed answer',
    'unless an error names them.',
    '',
    'ERRORS',
    ...issues.map((i) => `  - ${i.path}: ${i.message}`),
    '',
    'ITEM',
    JSON.stringify(item),
  ].join('\n');
}

export interface JobResult { accepted: number; rejected: number; live: number; outcomes: Outcome[]; reasons: Record<string, number>; costUsd: number; modality: 'text' | 'visual'; items: { item_id: string; live: boolean }[] }

/** Session work (and Tier C fallback) is live; stocking the bank is background. */
export const priorityOf = (kind: JobKind): 'live' | 'background' => (kind === 'live' || kind === 'live_fallback' ? 'live' : 'background');

export async function runJob(job: { job_id: string; kind: JobKind; plugin_id: string; task_type: string; locale: string; target_b: number; requested: number; modality?: 'text' | 'visual' | null }): Promise<JobResult> {
  const entry = registry().taskTypes.get(job.task_type);
  if (!entry) throw new Error(`unknown task type ${job.task_type}`);
  const { plugin, tt } = entry as { plugin: LoadedPlugin; tt: LoadedTaskType };
  const m = plugin.manifest;
  const band = bandOf(job.target_b, m.bank.b_band_width);
  const started = Date.now();
  const provider = getProvider();
  // Requested presentation modality: fixed for single-modality task types, otherwise as asked (or a 70/30 draw).
  const modality: 'text' | 'visual' = tt.def.modalities.length === 1 ? tt.def.modalities[0]! : job.modality && tt.def.modalities.includes(job.modality) ? job.modality : Math.random() < 0.7 ? 'text' : 'visual';
  const result: JobResult = { accepted: 0, rejected: 0, live: 0, outcomes: [], reasons: {}, costUsd: 0, modality, items: [] };
  const finish = async (state: string, error?: string) => {
    await q(
      `UPDATE generation_jobs SET state=$2, accepted=$3, rejected=$4, reject_reasons=$5, latency_ms=$6, error=$7, finished_at=now(), cost_usd=$8 WHERE job_id=$1`,
      [job.job_id, state, result.accepted, result.rejected, result.reasons, Date.now() - started, error ?? null, result.costUsd],
    );
    if (job.kind !== 'shadow') await updateBreaker(m.plugin_id, tt.def.id, job.locale, band);
  };

  if (job.kind !== 'shadow' && await breakerTripped(m.plugin_id, tt.def.id, job.locale, band)) { await finish('skipped', 'circuit breaker open'); return result; }
  if (provider.id !== 'local' && providerDegraded()) { await finish('skipped', 'provider paused (unavailable or quota used up)'); return result; }
  if (provider.id !== 'local' && (await spendToday()) >= config.DAILY_SPEND_CAP_USD) { await finish('skipped', 'daily spend cap reached: bank-only'); return result; }
  // Free-form written questions have their own prompt and an independent answer check.
  if (tt.def.generation === 'freeform') return runFreeformJob(job, plugin, tt, band, provider, result, finish);

  const seed = seed32();
  const rng = createRng(seed);
  const levers = resolveLevers(m, tt.def, job.target_b, rng);
  const services = servicesFor(job.locale, m.requires_services);
  const prefix = await assemblePrefix(plugin, tt.def.id, job.target_b);
  // New prompt versions (and, in production, new plugins) ride on probation: auto_promote is off for
  // their first PROBATION_ITEMS items so a human sees them. In development the first prompt version a
  // plugin ever used is exempt so the fixture bank is servable without an API key.
  const probation = (await probationRemaining(prefix.prompt_version, config.PROBATION_ITEMS)) > 0 && (isProd() || !(await isBaselinePrompt(prefix.prompt_version, m.plugin_id)));
  await q('UPDATE generation_jobs SET prompt_version=$2, model=$3, provider=$4 WHERE job_id=$1', [job.job_id, prefix.prompt_version, provider.model, provider.id]);
  const exclusions = await exclusionSignatures(m.plugin_id, tt.def.id, job.locale, band);
  const b = await estimateB(m.plugin_id, tt.def.id, job.locale, levers, job.target_b);
  const batchHashes = new Set<string>();
  let tokensIn = 0, tokensOut = 0;

  // Output budget per item: the protocol default, or the exemplar's size when that is larger (a 3×3
  // matrix with options is far bigger than a word item). A tight cap truncates JSON mid-array.
  const ex = plugin.exemplars.get(tt.def.id);
  const exChars = ex ? Math.max(...Object.values(ex).flat().map((x) => JSON.stringify(x).length)) : 0;
  const itemTokens = Math.max(ITEM_TOKENS[tt.def.protocol] ?? 600, Math.ceil(exChars / 2.5));
  let collected = 0;
  let attempts = 0;
  while (collected < job.requested && attempts < 3) {
    attempts++;
    const need = job.requested - collected;
    const callSeed = seed + attempts;
    const l2 = buildL2({
      taskType: tt.def.id, protocol: tt.def.protocol, count: need, locale: job.locale, readingLevel: m.prompt.reading_level,
      referentClasses: m.prompt.referent_classes, seed: callSeed, promptVersion: prefix.prompt_version, levers,
      accessibility: { ...tt.def.accessibility, text_alternative_required: tt.def.renderer.target === 'svg' && tt.def.protocol !== 'timed_block' },
      exclusionSignatures: exclusions, timedBlock: tt.def.protocol === 'timed_block',
      modality, modalityNote: tt.def.modality_notes[modality] ?? null,
      vocabulary: tt.vocabulary?.({ levers, services, taskType: tt.def }) ?? null,
    });
    const local = { plugin, taskType: tt, modality, levers, count: need, seed: callSeed, locale: job.locale, readingLevel: m.prompt.reading_level, services, exclusions };
    let res;
    try {
      res = await provider.generate({ priority: priorityOf(job.kind), prefix, request: l2, schema: GENERATION_JSON_SCHEMA, maxOutputTokens: Math.ceil(need * itemTokens * 1.6), thinking: m.prompt.thinking, seed: callSeed, timeoutMs: job.kind === 'live_fallback' ? config.TIER_C_BUDGET_MS : 60_000, local });
    } catch (e) {
      const pe = e as ProviderError;
      result.reasons[`provider_${pe.kind ?? 'error'}`] = (result.reasons[`provider_${pe.kind ?? 'error'}`] ?? 0) + 1;
      log('W1', `provider error (${pe.kind}): ${pe.message.slice(0, 160)}`);
      if (pe.kind === 'auth' || pe.kind === 'not_found') markDegraded(pe.message);
      // A quota that resets in minutes or hours (e.g. the free tier's requests per day): stop calling the
      // provider until then, so sessions go straight to the bank instead of waiting on doomed retries.
      if (pe.kind === 'quota' && (pe.retryAfterMs ?? 0) > 120_000) {
        markDegraded(`quota exhausted until ${new Date(Date.now() + pe.retryAfterMs!).toISOString()}: ${pe.message}`, Date.now() + pe.retryAfterMs!);
        await finish('failed', pe.message);
        return result;
      }
      if (!pe.retryable) { await finish('failed', pe.message); return result; }
      // Back off on 429 / 503 "high demand", using Gemini's own retry delay when it gives one.
      await new Promise((r) => setTimeout(r, Math.min(pe.retryAfterMs ?? 1000 * 2 ** attempts, 30_000)));
      continue;
    }
    tokensIn += res.usage.inputTokens;
    tokensOut += res.usage.outputTokens;
    result.costUsd += res.costUsd;
    const parsed = GenerationResponseSchema.safeParse(res.json);
    if (!parsed.success) { result.reasons.malformed_response = (result.reasons.malformed_response ?? 0) + 1; continue; }
    if (parsed.data.refusal && !parsed.data.items.length) { result.reasons.refusal = (result.reasons.refusal ?? 0) + 1; await audit('W1', 'model_refusal', 'job', job.job_id, { refusal: parsed.data.refusal }); break; }
    collected += parsed.data.items.length;

    for (const [i, raw] of parsed.data.items.entries()) {
      const outcome = await processCandidate(raw, {
        plugin, tt, levers, locale: job.locale, targetB: job.target_b, band, b, seed: (callSeed * 31 + i) >>> 0, jobId: job.job_id,
        promptVersion: prefix.prompt_version, services, probation, dryRun: job.kind === 'shadow', batchHashes, modality,
        provenance: { job_id: job.job_id, plugin_version: m.version, generator: { prompt_version: prefix.prompt_version, model: res.modelId, provider: provider.id, layer_hashes: prefix.layer_hashes, layer_ids: prefix.layer_ids, prefix_hash: prefix.hash } },
        repair: async (bad, issues) => {
          try {
            const r = await provider.generate({ priority: priorityOf(job.kind), prefix, request: l2, schema: GENERATION_JSON_SCHEMA, maxOutputTokens: 4000, thinking: m.prompt.thinking, timeoutMs: 60_000, followUp: { previous: JSON.stringify({ items: [bad] }), message: repairPrompt(issues, bad) }, local });
            result.costUsd += r.costUsd;
            return (r.json as { items?: unknown[] }).items?.[0] ?? null;
          } catch { return null; }
        },
      });
      result.outcomes.push(outcome);
      if (outcome.status === 'rejected') {
        result.rejected++;
        const k = `${outcome.gate}:${outcome.reason}`;
        result.reasons[k] = (result.reasons[k] ?? 0) + 1;
      } else if (outcome.status === 'quarantined') {
        result.rejected++;
        result.reasons[`bias:quarantine_${outcome.reason}`] = (result.reasons[`bias:quarantine_${outcome.reason}`] ?? 0) + 1;
      } else {
        result.accepted++;
        if (outcome.live) result.live++;
        result.items.push({ item_id: outcome.item_id, live: outcome.live });
      }
    }
  }
  await q('UPDATE generation_jobs SET tokens_in=$2, tokens_out=$3 WHERE job_id=$1', [job.job_id, tokensIn, tokensOut]);
  await finish('done');
  return result;
}

/** The first prompt version a plugin ever used is its baseline; probation applies to later changes and to new plugins' first items only via auto_promote. */
async function isBaselinePrompt(promptVersion: string, pluginId: string): Promise<boolean> {
  const first = await q1<{ pv: string }>("SELECT provenance->'generator'->>'prompt_version' AS pv FROM items WHERE plugin_id=$1 ORDER BY created_at LIMIT 1", [pluginId]);
  return !first || first.pv === promptVersion;
}

/** ≤ 3 short descriptors of items already banked in the cell (Doc 02 §1 row 8). */
async function exclusionSignatures(pluginId: string, taskType: string, locale: string, band: number): Promise<string[]> {
  const rows = await q<{ content_tags: string[]; blueprint: unknown }>(
    "SELECT content_tags, blueprint FROM items WHERE plugin_id=$1 AND task_type=$2 AND locale=$3 AND b_band=$4 AND status IN ('live','validated') ORDER BY created_at DESC LIMIT 3",
    [pluginId, taskType, locale, band],
  );
  return rows.map((r) => {
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (strings.length >= 4) return;
      if (typeof v === 'string' && v.length <= 24) strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk((r.blueprint as { phases?: unknown }).phases ?? r.blueprint);
    return `${r.content_tags.slice(-1)[0] ?? taskType}: ${strings.join('/')}`;
  });
}

/** Creates and runs a job immediately in this process (live generation, Tier C, admin tools, tests). */
export async function generateNow(spec: JobSpec): Promise<JobResult> {
  const id = await enqueueJob(spec);
  if (!id) throw new Error('a job for this cell is already queued');
  const job = await q1<{ job_id: string; kind: JobKind; plugin_id: string; task_type: string; locale: string; target_b: number; requested: number }>("UPDATE generation_jobs SET state='running', started_at=now(), attempts=1 WHERE job_id=$1 RETURNING *", [id]);
  try {
    return await runJob(job!);
  } catch (e) {
    await q("UPDATE generation_jobs SET state='failed', error=$2, finished_at=now() WHERE job_id=$1", [id, (e as Error).message]);
    throw e;
  }
}
