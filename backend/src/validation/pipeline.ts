// W2 validation pipeline (Doc 01 §7, Doc 04 §10). Five gates in order, fail-fast; every rejection is
// stored with its reason. Then: render all variants, hash, store, status = validated, and promote to
// live when the plugin allows it and nothing needs a human.
import {
  VARIANTS, createRng, fairTree, featureHash, modalityOf, renderCost, solveMatrix,
  type GateIssue, type LoadedPlugin, type LoadedTaskType, type Levers, type MatrixCell, type MatrixPuzzle, type MatrixRule, type RawItem, type ServiceBag, type Variant,
} from '@cognimetric/core';
import { config } from '../config';
import { q, q1, tx } from '../db/pool';
import { sha256, uuid } from '../util';
import { biasScreen, canonicalForm, structural } from './gates';
import { generationConfig } from '../live/config';

export interface PipelineCtx {
  plugin: LoadedPlugin;
  tt: LoadedTaskType;
  levers: Levers;
  locale: string;
  targetB: number;
  band: number;
  b: number;
  seed: number;
  jobId: string | null;
  promptVersion: string;
  provenance: Record<string, unknown>;
  services: ServiceBag;
  probation: boolean;
  dryRun?: boolean; // shadow runs validate but never insert
  repair?: (raw: unknown, issues: GateIssue[]) => Promise<unknown | null>;
  batchHashes: Set<string>;
  modality: 'text' | 'visual';
}

export type Outcome =
  | { status: 'accepted'; item_id: string; live: boolean; gates: Record<string, string> }
  | { status: 'quarantined'; item_id: string; reason: string }
  | { status: 'rejected'; gate: string; reason: string; detail?: unknown };

async function reject(ctx: PipelineCtx, gate: string, reason: string, detail: unknown, raw: unknown): Promise<Outcome> {
  if (!ctx.dryRun)
    await q(
      'INSERT INTO item_rejections (job_id, plugin_id, task_type, locale, b_band, prompt_version, gate, reason_code, detail, raw) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [ctx.jobId, ctx.plugin.manifest.plugin_id, ctx.tt.def.id, ctx.locale, ctx.band, ctx.promptVersion, gate, reason, JSON.stringify(detail ?? null), JSON.stringify(raw ?? null)],
    );
  return { status: 'rejected', gate, reason, detail };
}

const fails = (xs: GateIssue[]) => xs.filter((x) => x.severity === 'fail');

export async function processCandidate(raw: unknown, ctx: PipelineCtx): Promise<Outcome> {
  const { tt, plugin, levers } = ctx;
  const m = plugin.manifest;
  const def = tt.def;
  const needAlt = def.renderer.target === 'svg' && def.protocol !== 'timed_block';
  // Free-form questions are held to the written-question ceiling; every other type to its domain's level.
  const readingLevel = def.generation === 'freeform' ? `grade_${generationConfig().written.max_reading_grade}` : m.prompt.reading_level;
  const gates: Record<string, string> = {};
  const details: Record<string, unknown> = {};

  // Engine-owned fields (timings, announcements) are filled from the levers — normalisation only.
  if (tt.normalizer && raw && typeof raw === 'object') raw = tt.normalizer({ raw: structuredClone(raw) as Record<string, unknown>, levers });

  // ── Gate 1: structural (+ one repair turn, + plugin validators) ──────────────────
  let s = structural(raw, def, levers, readingLevel, needAlt);
  if (fails(s.issues).length && s.repairable && ctx.repair) {
    let repaired = await ctx.repair(raw, fails(s.issues));
    if (repaired && tt.normalizer && typeof repaired === 'object') repaired = tt.normalizer({ raw: structuredClone(repaired) as Record<string, unknown>, levers });
    if (repaired) {
      s = structural(repaired, def, levers, readingLevel, needAlt);
      raw = repaired;
      details.repaired = true;
    }
  }
  if (!s.item || fails(s.issues).length) {
    const first = fails(s.issues)[0];
    return reject(ctx, 'structural', first?.code ?? 'schema', s.issues, raw);
  }
  let item: RawItem = s.item;
  // The realised presentation modality must be the one requested (70/30 text/visual balancing).
  const realised = modalityOf(def, item.blueprint as never);
  if (realised !== ctx.modality) return reject(ctx, 'structural', 'modality_mismatch', { requested: ctx.modality, realised }, raw);
  const pluginIssues = tt.validators.flatMap((v) => v({ item, levers, services: ctx.services, manifest: m, taskType: def, modality: ctx.modality }));
  if (fails(pluginIssues).length) return reject(ctx, 'structural', fails(pluginIssues)[0]!.code === 'stimuli_listed_in_stem' ? 'forbidden_pattern' : fails(pluginIssues)[0]!.code, pluginIssues, raw);
  gates.structural = 'pass';

  // ── Gate 2: independent solver (no repair on key failure — Doc 02 §6.2) ──────────
  let expert = false;
  if (!tt.solver) {
    expert = true;
    gates.solver = 'warn';
    details.solver = { verdict: 'not_solvable_by_rule' };
  } else {
    const v = tt.solver({ item, levers, services: ctx.services, manifest: m, taskType: def });
    details.solver = v;
    if (v.verdict === 'not_solvable_by_rule') { expert = true; gates.solver = 'warn'; }
    else if (v.verdict !== 'key_confirmed') return reject(ctx, 'solver', v.verdict, v, raw);
    else gates.solver = 'pass';
  }

  // ── Engine-owned distractors (Doc 04 §10 step 8) + Gate 3 context-blind ──────────
  const tol = (m.context_blind_tolerance_pp ?? 8) / 100;
  let cbScore: number | null = null;
  const contextBlindScore = (it: RawItem) => {
    if (!tt.contextBlind) return null;
    const r = tt.contextBlind({ item: it, levers, services: ctx.services, manifest: m, taskType: def });
    const ps = r.per_question.map((dist, i) => dist[r.key_indices[i]!] ?? 0);
    const chance = r.per_question.reduce((sum, d) => sum + 1 / d.length, 0) / Math.max(1, r.per_question.length);
    return { score: ps.reduce((a, b) => a + b, 0) / Math.max(1, ps.length), chance };
  };
  if (def.distractor_policy === 'fair_tree') {
    const bp = item.blueprint as unknown as { puzzle: MatrixPuzzle; rule: MatrixRule; options: { count: number; items: MatrixCell[]; generation_policy: string } };
    const key = bp.options.items[item.answer_key.kind === 'index' ? item.answer_key.value : 0]!;
    const n = Math.round(Number(levers.option_count ?? bp.options.count ?? 5));
    const steps = levers.distractor_distance === 'far' ? 2 : 1;
    const rng = createRng(ctx.seed ^ 0x5f3759df);
    let accepted = false;
    for (let attempt = 0; attempt < 4 && !accepted; attempt++) {
      const ft = fairTree(bp.puzzle, bp.rule, key, n, rng, steps);
      if (!ft) break;
      const candidate: RawItem = { ...item, blueprint: { ...item.blueprint, options: { count: n, generation_policy: 'fair_tree', items: ft.options } }, answer_key: { kind: 'index', value: ft.keyIndex } };
      const recheck = solveMatrix({ puzzle: bp.puzzle, rule: bp.rule, options: ft.options, keyIndex: ft.keyIndex });
      if (recheck.verdict !== 'key_confirmed') continue;
      const cb = contextBlindScore(candidate);
      if (cb && cb.score > 1 / n + tol) { details.context_blind_resamples = attempt + 1; continue; }
      details.model_options = bp.options.items;
      item = candidate;
      cbScore = cb?.score ?? null;
      accepted = true;
    }
    if (!accepted) return reject(ctx, 'distractor', 'context_blind', { resamples: 4 }, raw);
  } else {
    const cb = contextBlindScore(item);
    if (cb) {
      cbScore = cb.score;
      if (cb.score > cb.chance + tol) return reject(ctx, 'distractor', 'context_blind', cb, raw);
    }
  }
  gates.distractor = tt.contextBlind ? 'pass' : 'pass';
  details.context_blind = cbScore === null ? 'not_applicable' : cbScore;

  // ── Gate 4: bias & safety ───────────────────────────────────────────────────────
  const bias = [...biasScreen(item, def), ...pluginIssues.filter((x) => x.severity === 'quarantine')];
  if (fails(bias).length) return reject(ctx, 'bias', fails(bias)[0]!.code, bias, raw);
  const quarantine = bias.find((x) => x.severity === 'quarantine');
  gates.bias = quarantine ? 'warn' : 'pass';

  // ── Gate 5: duplicate (exact canonical hash, then structural-embedding cosine ≥ 0.93) ──
  const { canonical, tokens } = canonicalForm(item, def, levers);
  const hash = `sha256:${sha256(canonical)}`;
  if (ctx.batchHashes.has(hash)) return reject(ctx, 'duplicate', 'duplicate_in_batch', null, raw);
  const exists = await q1('SELECT 1 FROM items WHERE plugin_id=$1 AND task_type=$2 AND blueprint_hash=$3', [m.plugin_id, def.id, hash]);
  if (exists) return reject(ctx, 'duplicate', 'duplicate_hash', null, raw);
  const vec = featureHash(tokens, 768);
  const vecLit = `[${vec.join(',')}]`;
  const near = await q1<{ sim: number }>(
    `SELECT 1 - (e.embedding <=> $1::vector) AS sim FROM item_embeddings e JOIN items i USING (item_id)
     WHERE i.plugin_id=$2 AND i.task_type=$3 AND i.locale=$4 AND i.b_band=$5 AND i.status <> 'retired'
     ORDER BY e.embedding <=> $1::vector LIMIT 1`,
    [vecLit, m.plugin_id, def.id, ctx.locale, ctx.band],
  );
  if (near && near.sim >= 0.93) return reject(ctx, 'duplicate', 'near_duplicate', { cosine: near.sim }, raw);
  ctx.batchHashes.add(hash);
  gates.duplicate = 'pass';

  // ── Render every required variant ───────────────────────────────────────────────
  const itemId = uuid();
  const renderings: { target: string; variant: Variant; payload: string }[] = [];
  if (tt.renderer) {
    const variants: Variant[] = def.renderer.target === 'svg' ? [...VARIANTS] : ['default'];
    for (const variant of variants) {
      const out = tt.renderer({ item, levers, seed: ctx.seed, variant, idPrefix: `i${itemId.slice(0, 8)}` });
      const payload = JSON.stringify(out.payload);
      if (def.renderer.target === 'svg' && renderCost(payload).nodes > 4000) return reject(ctx, 'render', 'render_cost', renderCost(payload), raw);
      renderings.push({ target: def.renderer.target, variant, payload });
    }
  }
  if (ctx.dryRun) return { status: 'accepted', item_id: itemId, live: false, gates };

  // ── Store, then promote ─────────────────────────────────────────────────────────
  const solverConfirmed = !expert;
  const auto = m.auto_promote && solverConfirmed && !quarantine && !ctx.probation;
  const status = quarantine ? 'quarantined' : auto ? 'live' : 'validated';
  const timeLimit = typeof levers.time_limit_ms === 'number' ? levers.time_limit_ms : def.default_time_limit_ms.single ?? null;
  const responseSpec = def.protocol === 'timed_block'
    ? { mode: 'timed_block' }
    : { mode: def.response_mode, time_limit_ms: timeLimit, per_probe_limit_ms: def.default_time_limit_ms.per_probe ?? null };
  try {
  await tx(async (c) => {
    await c.query(
      `INSERT INTO items (item_id, plugin_id, plugin_version, task_type, protocol, blueprint, levers, answer_key, response_spec, accessibility, locale, reading_level,
         content_tags, difficulty_b, discrimination_a, param_source, b_band, blueprint_hash, provenance, verification, rationale, text_alternative, status, review, modality)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
      [
        itemId, m.plugin_id, m.version, def.id, def.protocol, item.blueprint, levers, item.answer_key, responseSpec, def.accessibility, ctx.locale, readingLevel,
        item.content_tags ?? [], ctx.b, m.prior.a, expert ? 'expert' : 'lever_model', ctx.band, hash,
        { ...ctx.provenance, seed: ctx.seed, renderer_version: config.RENDERER_VERSION, blueprint_hash: hash, semantic_vector: 'feature-hash-768', model_options: details.model_options ?? null, lever_realisation: item.lever_realisation },
        { solver: def.solver, verdict: (details.solver as { verdict?: string })?.verdict ?? null, context_blind_score: cbScore, checked_at: new Date().toISOString(), repaired: !!details.repaired },
        item.rationale, item.text_alternative ?? null, status,
        status === 'live' ? { by: 'auto', at: new Date().toISOString(), notes: 'all gates passed; plugin auto_promote' } : { by: null, at: null, notes: quarantine ? `quarantined: ${quarantine.code}` : expert ? 'no independent solver: human review required' : ctx.probation ? 'prompt probation: human review required' : 'awaiting review' },
        ctx.modality,
      ],
    );
    for (const [gate, verdict] of Object.entries(gates))
      await c.query('INSERT INTO item_validations (item_id, gate, verdict, detail) VALUES ($1,$2,$3,$4)', [itemId, gate, verdict, JSON.stringify(gate === 'solver' ? details.solver : gate === 'distractor' ? { context_blind: details.context_blind } : gate === 'bias' ? bias : null)]);
    for (const r of renderings)
      await c.query('INSERT INTO item_renderings (item_id, target, variant, payload, renderer_ver, bytes) VALUES ($1,$2,$3,$4,$5,$6)', [itemId, r.target, r.variant, r.payload, config.RENDERER_VERSION, Buffer.byteLength(r.payload)]);
    await c.query('INSERT INTO item_embeddings (item_id, embedding) VALUES ($1, $2::vector)', [itemId, vecLit]);
    await c.query('INSERT INTO item_stats (item_id) VALUES ($1)', [itemId]);
  });
  } catch (e) {
    // items_hash_unique turns a concurrent duplicate into a database error, not a quality problem.
    if ((e as { code?: string }).code === '23505') return reject(ctx, 'duplicate', 'duplicate_hash', { concurrent: true }, raw);
    throw e;
  }
  if (quarantine) return { status: 'quarantined', item_id: itemId, reason: quarantine.code };
  return { status: 'accepted', item_id: itemId, live: status === 'live', gates };
}
