// Session Runtime (Doc 01 §2): owns a running administration — block plan, current phase, timers,
// idempotent response capture. Calls the adaptive engine for decisions; never calls the LLM except
// for a budgeted Tier-C fallback outside Block 0. Everything is persisted after every response so a
// restart of any process loses nothing (Doc 01 §13 criterion 5).
import { anchorsFor } from '../engine/levers';
import {
  BlockSubmissionSchema, CreateSubjectSchema, ENGINE_VERSION, ResponseSubmissionSchema, SubjectProfileSchema, canonicalJson, createRng,
  type BlockSpec, type BlockSubmission, type LoadedPlugin, type LoadedTaskType, type SubjectProfile, type TrialResult,
} from '@cognimetric/core';
import type pg from 'pg';
import { config, devTimeScale } from '../config';
import { audit, pool, q, q1, tx, type Db } from '../db/pool';
import { bankDepth, candidates, exposureRates, getItem, rendering, type Candidate } from '../bank/bank';
import { BATTERIES, type Battery } from '../engine/battery';
import { blockSd, eap, personFit, staircase, type Observation } from '../engine/irt';
import { bandOf, coverageBands, resolveLevers } from '../engine/levers';
import { accessibleTaskTypes, chooseItem, domainScore, itemInfo } from '../engine/selection';
import { enqueueJob, generateNow } from '../generation/service';
import { providerDegraded } from '../llm';
import { enabledPlugins } from '../plugins/sync';
import { registry } from '../plugins/registry';
import { HttpError, log, seed32, sha256, uuid } from '../util';
import { generationConfig } from '../live/config';
import { awaitBuffered, discardBuffer, domainPlan, inFlightCount, policyTick, readyItems, startInitialBuffer, userHistory } from '../live/live';
import type { AuthUser } from '../auth/service';

// ── Types ─────────────────────────────────────────────────────────────────────────────
interface DomainEngineState { n: number; task_type_counts: Record<string, number> }
export interface EngineState {
  domains: string[];
  block0: { plugin: string; target_b: number }[];
  block_index: number;
  per_domain: Record<string, DomainEngineState>;
  prev_domain: string | null;
  adaptive_served: number;
  confirmation: { domains: string[]; served: number; reasons: Record<string, string[]> } | null;
  substitutions: { plugin: string; from: string; to: string; reason: string }[];
  unmeasured: Record<string, string>;
  baseline: Record<string, number>;
  probes_offered: boolean;
  time_scale: number;
  stop_notes: string[];
  tiers: Record<string, number>;
}

interface SessionRow {
  session_id: string; subject_id: string; user_id: string | null; mode: 'live' | 'bank'; battery_id: string; phase: string; block_plan: Battery; engine_state: EngineState; locale: string;
  session_index: number; device_profile: unknown; flags: Record<string, unknown>; started_at: Date; last_activity_at: Date; suspended_at: Date | null; completed_at: Date | null; stop_reason: string | null;
}
interface AdminRow {
  administration_id: string; session_id: string; item_id: string; plugin_id: string; task_type: string; block_index: number; position: number; theta_at_serve: Record<string, number>;
  target_b: number | null; tier: string; substitution_distance: number; seed: number; option_order: number[][]; block_state: Record<string, unknown> | null; score: Record<string, unknown> | null; state: string; served_at: Date;
}

const primaryDim = (p: LoadedPlugin) => Object.entries(p.manifest.loading).sort((a, b) => b[1] - a[1])[0]![0];
const loadingsFor = (p: LoadedPlugin, taskType: string) => p.manifest.task_type_loadings[taskType] ?? p.manifest.loading;
const plugin = (id: string) => {
  const p = registry().plugins.get(id);
  if (!p) throw new HttpError(500, 'plugin_missing', `plugin ${id} is not loaded`);
  return p;
};
const taskType = (id: string) => {
  const t = registry().taskTypes.get(id);
  if (!t) throw new HttpError(500, 'task_type_missing', `task type ${id} is not loaded`);
  return t;
};

// ── Subjects ──────────────────────────────────────────────────────────────────────────
export async function createSubject(body: unknown) {
  const parsed = CreateSubjectSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, 'invalid_subject', 'subject profile failed validation', parsed.error.issues);
  const { external_ref, locale, profile } = parsed.data;
  if (external_ref) {
    const existing = await q1<{ subject_id: string }>('SELECT subject_id FROM subjects WHERE external_ref=$1', [external_ref]);
    if (existing) {
      await q('UPDATE subjects SET profile=$2, locale=$3 WHERE subject_id=$1', [existing.subject_id, profile, locale]);
      return { subject_id: existing.subject_id, resolved: true };
    }
  }
  const id = uuid();
  await q('INSERT INTO subjects (subject_id, external_ref, locale, profile) VALUES ($1,$2,$3,$4)', [id, external_ref ?? null, locale, profile]);
  return { subject_id: id, resolved: false };
}

// ── Sessions ──────────────────────────────────────────────────────────────────────────
export async function createSession(body: { subject_id?: string; battery_id?: string }, user?: AuthUser) {
  if (user) body = { ...body, subject_id: user.subject_id };
  const subject = await q1<{ subject_id: string; locale: string; profile: SubjectProfile; session_count: number }>('SELECT * FROM subjects WHERE subject_id=$1', [body.subject_id]);
  if (!subject) throw new HttpError(404, 'subject_not_found', 'unknown subject_id');
  const battery = BATTERIES[body.battery_id ?? 'standard_5domain_v1'];
  if (!battery) throw new HttpError(400, 'unknown_battery', `battery must be one of ${Object.keys(BATTERIES).join(', ')}`);
  const profile = SubjectProfileSchema.parse(subject.profile);
  const enabled = await enabledPlugins(registry());
  const domains = enabled.map((p) => p.manifest.plugin_id).filter((id) => battery.domains === '*' || battery.domains.includes(id));
  const state: EngineState = {
    domains, block0: [], block_index: 0, per_domain: {}, prev_domain: null, adaptive_served: 0, confirmation: null,
    substitutions: [], unmeasured: {}, baseline: {}, probes_offered: false, time_scale: devTimeScale(), stop_notes: [], tiers: { A: 0, B: 0, C: 0 },
  };
  for (const d of domains) {
    state.per_domain[d] = { n: 0, task_type_counts: {} };
    const acc = accessibleTaskTypes(plugin(d), profile);
    if (acc.unmeasured) state.unmeasured[d] = acc.unmeasured;
    for (const s of acc.substitutions) state.substitutions.push({ plugin: d, ...s });
  }
  const b0 = battery.blocks.find((b) => b.kind === 'calibration');
  if (b0) {
    const targets = b0.b_targets ?? [0];
    for (let k = 0; k < (b0.items_per_domain ?? 2); k++)
      for (const d of domains) if (!state.unmeasured[d]) state.block0.push({ plugin: d, target_b: targets[k % targets.length]! });
  }
  const sessionId = uuid();
  const index = subject.session_count + 1;
  // Live mode: questions are generated in real time for this session (bank as fallback).
  const mode: 'live' | 'bank' = generationConfig().mode === 'live' && !providerDegraded() ? 'live' : 'bank';
  const prev = await q<{ dimension: string; theta: number }>(
    `SELECT a.dimension, a.theta FROM ability_estimates a JOIN sessions s USING (session_id)
     WHERE s.subject_id=$1 AND s.phase='done' AND a.method='eap' ORDER BY s.completed_at DESC`, [subject.subject_id]);
  await tx(async (c) => {
    await c.query('INSERT INTO sessions (session_id, subject_id, user_id, mode, battery_id, phase, block_plan, engine_state, locale, session_index, flags, engine_ver) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
      sessionId, subject.subject_id, user?.user_id ?? null, mode, battery.battery_id, 'calibration', battery, state, subject.locale, index,
      { dev_time_scale: state.time_scale !== 1 ? state.time_scale : null, profile_snapshot: profile, prior_session_thetas: Object.fromEntries(prev.map((r) => [r.dimension, r.theta])) },
      ENGINE_VERSION,
    ]);
    await c.query('UPDATE subjects SET session_count = session_count + 1 WHERE subject_id=$1', [subject.subject_id]);
    const dims = new Set(domains.flatMap((d) => plugin(d).manifest.dimensions));
    for (const dim of dims) {
      const p = prev.find((r) => r.dimension === dim);
      await c.query('INSERT INTO ability_estimates (session_id, dimension, theta, se, n_items, method) VALUES ($1,$2,$3,$4,0,$5)', [sessionId, dim, p?.theta ?? 0, p ? 1.2 : 1, 'prior']);
    }
  });
  if (user) await q("INSERT INTO user_events (user_id, kind, detail) VALUES ($1,'session_started',$2)", [user.user_id, { session_id: sessionId, battery_id: battery.battery_id, mode }]);
  if (mode === 'live') startInitialBuffer(sessionId, subject.locale, domains.filter((d) => !state.unmeasured[d]), b0?.b_targets ?? [0]);
  return {
    session_id: sessionId,
    session_index: index,
    mode,
    phase: 'calibration',
    block_plan: battery,
    first_block: { index: 0, kind: 'calibration', items: state.block0.length, domains: domains.filter((d) => !state.unmeasured[d]) },
    unmeasured: state.unmeasured,
    substitutions: state.substitutions,
    dev_time_scale: state.time_scale !== 1 ? state.time_scale : null,
  };
}

async function lockSession(c: pg.PoolClient, id: string): Promise<SessionRow> {
  // NO KEY UPDATE still serialises concurrent calls on one session, but unlike FOR UPDATE it does not
  // block inserts that reference the session (FK KEY SHARE). Live generation inserts into
  // session_buffer while administer() waits for it inside this transaction.
  const s = await q1<SessionRow>('SELECT * FROM sessions WHERE session_id=$1 FOR NO KEY UPDATE', [id], c);
  if (!s) throw new HttpError(404, 'session_not_found', 'unknown session');
  return s;
}

async function saveState(c: Db, s: SessionRow, phase?: string) {
  await q('UPDATE sessions SET engine_state=$2, phase=$3, last_activity_at=now() WHERE session_id=$1', [s.session_id, s.engine_state, phase ?? s.phase], c);
  if (phase) s.phase = phase;
}

async function finish(c: Db, s: SessionRow, reason: string) {
  s.engine_state.stop_notes.push(reason);
  await q("UPDATE sessions SET phase='done', engine_state=$2, completed_at=now(), stop_reason=$3, last_activity_at=now() WHERE session_id=$1", [s.session_id, s.engine_state, reason], c);
  s.phase = 'done';
  await discardBuffer(s.session_id, c);
  await audit('engine', 'session_completed', 'session', s.session_id, { reason }, c);
  if (s.user_id) await q("INSERT INTO user_events (user_id, kind, detail) VALUES ($1,'session_completed',$2)", [s.user_id, { session_id: s.session_id, reason }], c);
}

// ── Ability ───────────────────────────────────────────────────────────────────────────
interface ScoredAdmin { plugin_id: string; task_type: string; score: Record<string, unknown>; difficulty_b: number; discrimination_a: number; time_limit_ms: number | null; position: number }

export async function recomputeAbility(c: Db, s: SessionRow, dims?: string[]) {
  const rows = await q<ScoredAdmin>(
    `SELECT a.plugin_id, a.task_type, a.score, i.difficulty_b, i.discrimination_a, (i.response_spec->>'time_limit_ms')::int AS time_limit_ms, a.position
     FROM administrations a JOIN items i USING (item_id) WHERE a.session_id=$1 AND a.state='answered' ORDER BY a.position`, [s.session_id], c);
  const prior = (s.flags.prior_session_thetas ?? {}) as Record<string, number>;
  const allDims = dims ?? [...new Set(rows.flatMap((r) => Object.keys(loadingsFor(plugin(r.plugin_id), r.task_type))))];
  for (const dim of allDims) {
    const obs: (Observation & { rt: number | null; tl: number | null })[] = [];
    let primaryN = 0;
    for (const r of rows) {
      const p = plugin(r.plugin_id);
      const w = loadingsFor(p, r.task_type)[dim] ?? 0;
      if (w <= 0) continue;
      if (w >= 0.5) primaryN++;
      const sc = r.score as { kind: string; u?: number; perf?: number; s?: number; rt_ms?: number | null };
      if (sc.kind === 'block') obs.push({ kind: 'normal', perf: sc.perf!, s: sc.s!, loading: w, rt: null, tl: null });
      else obs.push({ kind: 'binary', a: r.discrimination_a, b: r.difficulty_b, u: sc.u!, loading: w, rt: sc.rt_ms ?? null, tl: r.time_limit_ms });
    }
    if (!obs.length) continue;
    let theta: number, se: number, mle: number | null = null, method: string;
    // Staircase for the first two responses in a domain; EAP from the third (Doc 05 §4.1–4.2).
    if (primaryN < 3) {
      theta = prior[dim] ?? 0;
      for (const o of obs) theta = o.kind === 'normal' ? Math.max(-3, Math.min(3, o.perf)) : staircase(theta, o.u >= 0.5, o.rt, o.tl);
      se = 1.0;
      method = 'staircase';
    } else {
      const est = eap(obs, prior[dim] !== undefined ? { mu: prior[dim]!, sigma: 1.2 } : { mu: 0, sigma: 1 });
      theta = est.theta; se = est.se; mle = est.mle; method = 'eap';
    }
    await q(
      `INSERT INTO ability_estimates (session_id, dimension, theta, se, theta_mle, n_items, method, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())
       ON CONFLICT (session_id, dimension) DO UPDATE SET theta=$3, se=$4, theta_mle=$5, n_items=$6, method=$7, updated_at=now()`,
      [s.session_id, dim, theta, se, mle, obs.length, method], c,
    );
  }
}

async function abilities(c: Db, sessionId: string): Promise<Record<string, { theta: number; se: number; n: number; method: string }>> {
  const rows = await q<{ dimension: string; theta: number; se: number; n_items: number; method: string }>('SELECT * FROM ability_estimates WHERE session_id=$1', [sessionId], c);
  return Object.fromEntries(rows.map((r) => [r.dimension, { theta: r.theta, se: r.se, n: r.n_items, method: r.method }]));
}

// ── Next ──────────────────────────────────────────────────────────────────────────────
export async function next(sessionId: string): Promise<Record<string, unknown>> {
  return tx(async (c) => {
    const s = await lockSession(c, sessionId);
    if (s.phase === 'done') return { done: true, stop_reason: s.stop_reason, report_ready: true };
    if (s.suspended_at) {
      if (Date.now() - new Date(s.suspended_at).getTime() > 24 * 3600_000) {
        await finish(c, s, 'abandoned');
        return { done: true, stop_reason: 'abandoned', report_ready: true };
      }
      await q('UPDATE sessions SET suspended_at=NULL WHERE session_id=$1', [sessionId], c);
    }
    // Resume: an administration that was served but not answered is served again unchanged.
    const open = await q1<AdminRow>("SELECT * FROM administrations WHERE session_id=$1 AND state='served' ORDER BY position DESC LIMIT 1", [sessionId], c);
    if (open) return { done: false, resumed: true, unit: await servePayload(c, s, open) };

    // Delayed-recall capture after Block 0 (Doc 05 §10).
    if (s.engine_state.block_index >= 1 && !s.engine_state.probes_offered) {
      const cap = await probeCapture(c, s);
      if (cap) return { done: false, unit: cap };
    }

    for (let attempt = 0; attempt < 6; attempt++) {
      const decision = await decide(c, s);
      if ('done' in decision) {
        await finish(c, s, decision.reason);
        return { done: true, stop_reason: decision.reason, report_ready: true };
      }
      const admin = await administer(c, s, decision.plugin, decision.target_b, decision.bankOnly);
      if (admin) return { done: false, unit: await servePayload(c, s, admin) };
      s.engine_state.stop_notes.push(`no servable item for ${decision.plugin} at b≈${decision.target_b.toFixed(2)}`);
      s.engine_state.unmeasured[decision.plugin] ??= 'The item bank had no servable item for this domain.';
      await saveState(c, s);
    }
    await finish(c, s, 'bank_exhausted');
    return { done: true, stop_reason: 'bank_exhausted', report_ready: true };
  });
}

type Decision = { plugin: string; target_b: number; bankOnly: boolean } | { done: true; reason: string };

async function decide(c: Db, s: SessionRow): Promise<Decision> {
  const st = s.engine_state;
  const g = s.block_plan.global;
  const served = await q1<{ n: number }>("SELECT count(*)::int AS n FROM administrations WHERE session_id=$1 AND state <> 'unmeasured'", [s.session_id], c);
  if ((served?.n ?? 0) >= g.max_items) return { done: true, reason: 'item_budget' };
  if (Date.now() - new Date(s.started_at).getTime() >= g.max_duration_min * 60_000) return { done: true, reason: 'time_budget' };
  if (await fatigued(c, s.session_id)) return { done: true, reason: 'fatigue' };
  const ab = await abilities(c, s.session_id);

  for (let guard = 0; guard < 8; guard++) {
    const block = s.block_plan.blocks[st.block_index];
    if (!block || block.kind === 'delayed_probe') return { done: true, reason: 'plan_complete' };
    if (block.kind === 'calibration') {
      while (st.block0.length) {
        const nx = st.block0.shift()!;
        if (st.unmeasured[nx.plugin]) continue;
        await saveState(c, s, 'calibration');
        return { plugin: nx.plugin, target_b: nx.target_b, bankOnly: true };
      }
      st.block_index++;
      await saveState(c, s, s.block_plan.blocks[st.block_index]?.kind === 'adaptive' ? 'adaptive' : s.phase);
      continue;
    }
    const domains = st.domains.filter((d) => !st.unmeasured[d]);
    const dstate = (d: string) => {
      const p = plugin(d);
      const e = ab[primaryDim(p)] ?? { theta: 0, se: 1, n: 0, method: 'prior' };
      return { p, e, n: st.per_domain[d]!.n, target: p.manifest.target_se ?? g.target_se };
    };
    const pickDomain = async (pool: string[], requireSe: boolean) => {
      const nMean = pool.reduce((s2, d) => s2 + st.per_domain[d]!.n, 0) / Math.max(1, pool.length);
      let best: { d: string; score: number; theta: number } | null = null;
      for (const d of pool) {
        const x = dstate(d);
        if (x.n >= g.max_per_domain) continue;
        if (requireSe && x.e.method === 'eap' && x.e.se <= x.target) continue;
        const allowed = accessibleTaskTypes(x.p, SubjectProfileSchema.parse(s.flags.profile_snapshot ?? {})).allowed;
        const cand: Pick<Candidate, 'difficulty_b' | 'discrimination_a'>[] = await candidates(d, s.locale, allowed, s.session_id, x.e.theta, 20, c, servesUnreviewed());
        if (s.mode === 'live') {
          cand.push(...(await readyItems(s.session_id, d, allowed, c)));
          // Live generation can always produce an item at θ: its information is the prior a at b = θ.
          if (!providerDegraded()) cand.push({ difficulty_b: x.e.theta, discrimination_a: x.p.manifest.prior.a });
        }
        if (!cand.length) continue;
        const bestInfo = Math.max(...cand.map((k) => itemInfo(k as Candidate, x.e.theta)));
        if (bestInfo < 0.05) continue;
        const sc = domainScore(bestInfo, { n: x.n, theta: x.e.theta, se: x.e.method === 'eap' ? x.e.se : 1, target_se: x.target, taskTypeCounts: {} }, nMean, st.prev_domain === d);
        if (!best || sc > best.score) best = { d, score: sc, theta: x.e.theta };
      }
      return best;
    };
    if (block.kind === 'adaptive') {
      if (st.adaptive_served < (block.max_items ?? 20)) {
        const best = await pickDomain(domains, true);
        if (best) {
          st.adaptive_served++;
          await saveState(c, s, 'adaptive');
          return { plugin: best.d, target_b: best.theta, bankOnly: false };
        }
        const allPrecise = domains.every((d) => { const x = dstate(d); return x.e.method === 'eap' && x.e.se <= x.target; });
        st.stop_notes.push(allPrecise ? 'adaptive: precision reached in every domain' : 'adaptive: information exhausted or per-domain caps reached');
      }
      st.block_index++;
      continue;
    }
    if (block.kind === 'confirmation') {
      if (!st.confirmation) {
        const reasons: Record<string, string[]> = {};
        for (const d of domains) {
          const x = dstate(d);
          const r: string[] = [];
          if ((block.triggers ?? []).includes('se_above_target') && (x.e.method !== 'eap' || x.e.se > x.target)) r.push('se_above_target');
          if ((block.triggers ?? []).includes('boundary') && x.e.method === 'eap' && [-1, 1].some((bd) => Math.abs(x.e.theta - bd) < 0.15)) r.push('boundary');
          if ((block.triggers ?? []).includes('misfit') && (await misfit(c, s, d, x.e.theta))) r.push('misfit');
          if (r.length) reasons[d] = r;
        }
        st.confirmation = { domains: Object.keys(reasons), served: 0, reasons };
        await saveState(c, s, 'confirmation');
      }
      if (st.confirmation.served < (block.max_items ?? 6) && st.confirmation.domains.length) {
        const best = await pickDomain(st.confirmation.domains, false);
        if (best) {
          st.confirmation.served++;
          await saveState(c, s, 'confirmation');
          return { plugin: best.d, target_b: best.theta, bankOnly: false };
        }
      }
      st.block_index++;
      continue;
    }
    st.block_index++;
  }
  return { done: true, reason: 'plan_complete' };
}

async function misfit(c: Db, s: SessionRow, d: string, theta: number): Promise<boolean> {
  const rows = await q<{ score: { kind: string; u?: number }; difficulty_b: number; discrimination_a: number }>(
    "SELECT a.score, i.difficulty_b, i.discrimination_a FROM administrations a JOIN items i USING (item_id) WHERE a.session_id=$1 AND a.plugin_id=$2 AND a.state='answered'", [s.session_id, d], c);
  const obs: Observation[] = rows.filter((r) => r.score.kind === 'choice').map((r) => ({ kind: 'binary', a: r.discrimination_a, b: r.difficulty_b, u: r.score.u!, loading: 1 }));
  return personFit(theta, obs) > 2;
}

/** Fatigue: RT inflation > 40 % over the session's own baseline with accuracy declining (Doc 05 §7). */
async function fatigued(c: Db, sessionId: string): Promise<boolean> {
  const rows = await q<{ score: { kind: string; u?: number; pace?: number } }>(
    "SELECT score FROM administrations WHERE session_id=$1 AND state='answered' AND score->>'kind'='choice' ORDER BY position", [sessionId], c);
  if (rows.length < 12) return false;
  const pace = (xs: typeof rows) => xs.reduce((a, r) => a + (r.score.pace ?? 0), 0) / xs.length;
  const acc = (xs: typeof rows) => xs.reduce((a, r) => a + (r.score.u ?? 0), 0) / xs.length;
  const first = rows.slice(0, 6);
  const last = rows.slice(-6);
  return pace(first) > 0 && pace(last) > 1.4 * pace(first) && acc(last) < acc(first);
}

/** Whether the bank may serve 'validated' items (passed every automatic gate, awaiting review). */
const servesUnreviewed = () => generationConfig().serve_unreviewed_live_items;

/** The modality this session is furthest below its configured share of (text when nothing is served yet). */
async function wantedModality(c: Db, sessionId: string): Promise<'text' | 'visual'> {
  const counts = await q1<{ text: number; total: number }>("SELECT count(*) FILTER (WHERE modality='text')::int AS text, count(*) FILTER (WHERE modality IS NOT NULL)::int AS total FROM administrations WHERE session_id=$1", [sessionId], c);
  const share = generationConfig().modality_ratio.text;
  if (!counts?.total) return 'text';
  return counts.text / counts.total < share ? 'text' : 'visual';
}

// ── Administering an item ─────────────────────────────────────────────────────────────
async function administer(c: Db, s: SessionRow, pluginId: string, targetB: number, bankOnly: boolean): Promise<AdminRow | null> {
  const st = s.engine_state;
  const p = plugin(pluginId);
  const m = p.manifest;
  const profile = SubjectProfileSchema.parse(s.flags.profile_snapshot ?? {});
  const access = accessibleTaskTypes(p, profile);
  let allowed = access.allowed;
  // Mandatory task types (e.g. the simple-RT motor baseline) come first in a plugin.
  const mandatory = m.mandatory_task_types.filter((t) => allowed.includes(t) && !(st.per_domain[pluginId]!.task_type_counts[t] ?? 0));
  if (mandatory.length) allowed = mandatory;
  const rng = createRng(seed32());
  const width = m.bank.b_band_width;
  let tier = 'A';
  let substitution = 0;
  let source = 'bank';

  // Live sessions serve from their own buffer of freshly generated questions; the bank is the fallback.
  if (s.mode === 'live') {
    const cfg = generationConfig();
    let ready = await readyItems(s.session_id, pluginId, allowed, c);
    if (!ready.length) {
      const waitMs = st.per_domain[pluginId]!.n === 0 ? cfg.wait_ms.initial : cfg.wait_ms.refill;
      await awaitBuffered(s.session_id, s.locale, pluginId, allowed, targetB, waitMs);
      ready = await readyItems(s.session_id, pluginId, allowed, c);
    }
    if (ready.length) {
      // The modality the session is short of first (keeps it at the configured text/visual ratio),
      // then difficulty to the nearest half logit, then the task type this user has seen least.
      const wanted = await wantedModality(c, s.session_id);
      const seen = await userHistory(s.session_id, c);
      const near = (x: { difficulty_b: number }) => Math.round(Math.abs(x.difficulty_b - targetB) * 2);
      ready.sort((a, b) => Number(b.modality === wanted) - Number(a.modality === wanted) || near(a) - near(b) || (seen.get(a.task_type) ?? 0) - (seen.get(b.task_type) ?? 0));
      const pickLive = ready[0]!;
      await q("UPDATE session_buffer SET state='served', served_at=now() WHERE buffer_id=$1", [pickLive.buffer_id], c);
      return insertAdministration(c, s, p, pickLive.item_id, pickLive.task_type, targetB, 'L', Math.abs(pickLive.difficulty_b - targetB), 'live', pickLive.modality);
    }
    source = 'bank_fallback';
    st.stop_notes.push(`live buffer empty for ${pluginId}: served from the bank`);
  }

  // Bank path: prefer task types that offer the modality the session is short of.
  {
    const wanted = await wantedModality(c, s.session_id);
    const fit = allowed.filter((t) => m.task_types.find((x) => x.id === t)?.modalities.includes(wanted));
    if (fit.length && fit.length < allowed.length && (await candidates(pluginId, s.locale, fit, s.session_id, targetB, 1, c, servesUnreviewed())).length) allowed = fit;
  }
  let cand = await candidates(pluginId, s.locale, allowed, s.session_id, targetB, 60, c, servesUnreviewed());
  const nearest = cand.length ? Math.abs(cand[0]!.difficulty_b - targetB) : Infinity;
  // Tier C: a budgeted live generation when the bank misses the cell — never in Block 0, never when the provider is degraded.
  if (nearest > width && !bankOnly && !providerDegraded() && s.mode !== 'live') {
    const tt = allowed.slice().sort((a, b) => (m.task_types.find((x) => x.id === b)!.weight - m.task_types.find((x) => x.id === a)!.weight))[0]!;
    try {
      const budget = new Promise<null>((r) => setTimeout(() => r(null), config.TIER_C_BUDGET_MS));
      const gen = generateNow({ kind: 'live_fallback', pluginId, taskType: tt, locale: s.locale, targetB, requested: 2 }).catch(() => null);
      const r = await Promise.race([gen, budget]);
      if (r && r.live > 0) { cand = await candidates(pluginId, s.locale, allowed, s.session_id, targetB, 60, c, servesUnreviewed()); tier = 'C'; }
    } catch { /* fall through to substitution */ }
  }
  if (!cand.length) return null;
  const counts = st.per_domain[pluginId]!.task_type_counts;
  const weights = Object.fromEntries(m.task_types.map((t) => [t.id, t.weight]));
  for (const sub of access.substitutions) weights[sub.to] = (weights[sub.to] ?? 0) + (weights[sub.from] ?? 0);
  const exposure = await exposureRates(pluginId, cand.map((x) => x.item_id), c);
  const choice = chooseItem({ theta: targetB, cand, exposure, weights, counts, nDomain: st.per_domain[pluginId]!.n, maxPerDomain: s.block_plan.global.max_per_domain, rng })
    ?? { pick: cand[0]!, utility: 0, info: itemInfo(cand[0]!, targetB) };
  const pick: Candidate = choice.pick;
  substitution = Math.abs(pick.difficulty_b - targetB);
  if (tier === 'A' && pick.job_kind === 'speculative') tier = 'B';
  if (tier === 'A' && substitution > width) st.stop_notes.push(`substituted ${pluginId} item at distance ${substitution.toFixed(2)}`);
  const picked = await q1<{ modality: string | null }>('SELECT modality FROM items WHERE item_id=$1', [pick.item_id], c);
  const admin = await insertAdministration(c, s, p, pick.item_id, pick.task_type, targetB, tier, substitution, source, picked?.modality ?? null);
  if (s.mode !== 'live') void speculate(pluginId, pick, (await abilities(c, s.session_id))[primaryDim(p)]?.theta ?? 0, s.locale, allowed).catch((e) => log('speculate', String(e)));
  return admin;
}

async function insertAdministration(c: Db, s: SessionRow, p: LoadedPlugin, itemId: string, taskTypeId: string, targetB: number, tier: string, substitution: number, source: string, modality: string | null): Promise<AdminRow> {
  const st = s.engine_state;
  const pluginId = p.manifest.plugin_id;
  const counts = st.per_domain[pluginId]!.task_type_counts;
  const pick = { task_type: taskTypeId };
  const item = (await getItem(itemId, c))!;
  const ab = await abilities(c, s.session_id);
  const position = ((await q1<{ n: number }>('SELECT count(*)::int AS n FROM administrations WHERE session_id=$1', [s.session_id], c))?.n ?? 0) + 1;
  const seed = seed32();
  const optionOrder = optionPermutations(item.blueprint, createRng(seed));
  const adminId = uuid();
  let blockState: Record<string, unknown> | null = null;
  if (item.protocol === 'timed_block') {
    const spec = expandBlock(pick.task_type, item, seed, st.time_scale);
    blockState = { sequence_hash: sequenceHash(spec), attempt: 1, seed, n_trials: spec.trials.length };
  }
  await q(
    `INSERT INTO administrations (administration_id, session_id, item_id, plugin_id, task_type, block_index, position, theta_at_serve, target_b, tier, substitution_distance, seed, option_order, block_state, source, modality)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [adminId, s.session_id, item.item_id, pluginId, pick.task_type, st.block_index, position, Object.fromEntries(Object.entries(ab).map(([k, v]) => [k, v.theta])), targetB, tier, substitution, seed, JSON.stringify(optionOrder), blockState, source, modality], c,
  );
  st.per_domain[pluginId]!.n++;
  counts[pick.task_type] = (counts[pick.task_type] ?? 0) + 1;
  st.prev_domain = pluginId;
  st.tiers[tier] = (st.tiers[tier] ?? 0) + 1;
  await saveState(c, s);
  await q('UPDATE item_stats SET last_exposed_at=now() WHERE item_id=$1', [item.item_id], c);
  if (s.mode === 'live') setTimeout(() => void policyTick(s.session_id), 0);
  return (await q1<AdminRow>('SELECT * FROM administrations WHERE administration_id=$1', [adminId], c))!;
}

/** Speculative pre-generation for the two likely next states θ⁺ / θ⁻ (Doc 01 §6.2). */
async function speculate(pluginId: string, served: Candidate, theta: number, locale: string, allowed: string[]) {
  const p = plugin(pluginId);
  const width = p.manifest.bank.b_band_width;
  const obs: Observation = { kind: 'binary', a: served.discrimination_a, b: served.difficulty_b, u: 1, loading: 1 };
  const plus = eap([obs], { mu: theta, sigma: 1 }).theta;
  const minus = eap([{ ...obs, u: 0 }], { mu: theta, sigma: 1 }).theta;
  const tt = allowed.slice().sort((a, b) => (p.manifest.task_types.find((x) => x.id === b)!.weight - p.manifest.task_types.find((x) => x.id === a)!.weight))[0]!;
  const def = p.manifest.task_types.find((x) => x.id === tt)!;
  const bands = coverageBands(p.manifest, def);
  for (const t of [plus, minus]) {
    // Only cells the task type's lever policy can realise; outside its anchors, speculation is waste.
    const band = bands.reduce((best, c) => (Math.abs(c - t) < Math.abs(best - t) ? c : best), bands[0] ?? bandOf(t, width));
    if ((await bankDepth(pluginId, tt, locale, band)) < 3) await enqueueJob({ kind: 'speculative', pluginId, taskType: tt, locale, targetB: band, requested: 2 });
  }
}

function optionPermutations(bp: Record<string, unknown>, rng: ReturnType<typeof createRng>): number[][] {
  const phases = (bp.phases ?? []) as { phase: string; options?: unknown[]; probes?: { options?: unknown[] }[] }[];
  const sets: number[] = [];
  const opts = (bp.options as { items?: unknown[] } | undefined)?.items;
  if (opts) sets.push(opts.length);
  else for (const ph of phases) {
    if (ph.options) sets.push(ph.options.length);
    for (const pr of ph.probes ?? []) if (pr.options) sets.push(pr.options.length);
  }
  return sets.map((n) => rng.shuffle(Array.from({ length: n }, (_, i) => i)));
}

// Length levers are capped at the largest value the task type's current anchors use, so items banked
// under older, longer settings still run at today's length. Difficulty levers are left untouched.
const LENGTH_LEVERS = ['trials', 'block_duration_s'];

export function lengthCapped(taskTypeId: string, levers: Record<string, unknown>): Record<string, unknown> {
  const { plugin: pl } = taskType(taskTypeId);
  let anchors: Record<string, Record<string, unknown>>;
  try { anchors = anchorsFor(pl.manifest, taskTypeId) as Record<string, Record<string, unknown>>; } catch { return levers; }
  const out = { ...levers };
  for (const l of LENGTH_LEVERS) {
    const max = Math.max(...Object.values(anchors).map((a) => Number(a[l])).filter(Number.isFinite));
    if (Number.isFinite(max) && typeof out[l] === 'number' && (out[l] as number) > max) out[l] = max;
  }
  return out;
}

function expandBlock(taskTypeId: string, item: { blueprint: unknown; levers: unknown; task_type: string; answer_key: unknown }, seed: number, timeScale: number): BlockSpec {
  const tt = taskType(taskTypeId).tt as LoadedTaskType;
  if (!tt.expander) throw new HttpError(500, 'no_expander', `no expander for ${taskTypeId}`);
  const levers = lengthCapped(taskTypeId, item.levers as Record<string, unknown>);
  return tt.expander({ item: { ...(item as object), levers } as never, levers: levers as never, seed, rng: createRng(seed), timeScale });
}

const sequenceHash = (b: BlockSpec) => `sha256:${sha256(canonicalJson({ practice: b.practice, trials: b.trials }))}`;

function variantFor(profile: SubjectProfile): 'default' | 'high_contrast' | 'large' {
  if (profile.high_contrast) return 'high_contrast';
  if (profile.vision === 'low' || profile.large_targets) return 'large';
  return 'default';
}

async function servePayload(c: Db, s: SessionRow, a: AdminRow) {
  const item = (await getItem(a.item_id, c))!;
  const p = plugin(a.plugin_id);
  const tdef = p.manifest.task_types.find((t) => t.id === a.task_type)!;
  const profile = SubjectProfileSchema.parse(s.flags.profile_snapshot ?? {});
  const base = {
    kind: 'item' as const,
    administration_id: a.administration_id,
    position: a.position,
    block_index: a.block_index,
    phase: s.phase,
    plugin: { id: p.manifest.plugin_id, name: p.manifest.scoring.report_label },
    task_type: a.task_type,
    source: (a as AdminRow & { source?: string }).source ?? 'bank',
    modality: (a as AdminRow & { modality?: string | null }).modality ?? null,
    protocol: item.protocol,
    renderer: tdef.renderer.target,
    response_spec: item.response_spec,
    text_alternative: item.text_alternative,
    large_targets: profile.large_targets || profile.motor === 'limited',
    reveal_feedback: s.block_plan.global.reveal_feedback,
    progress: await progress(c, s),
  };
  if (item.protocol === 'timed_block') {
    const bs = a.block_state!;
    const spec = expandBlock(a.task_type, item, Number(bs.seed), s.engine_state.time_scale);
    return { ...base, block: { ...spec, sequence_hash: bs.sequence_hash, attempt: bs.attempt } };
  }
  const payload = (await rendering(item.item_id, variantFor(profile), c)) as Record<string, unknown>;
  const perms = a.option_order;
  const permute = <T>(xs: T[], perm: number[] | undefined) => (perm ? perm.map((i) => xs[i]!) : xs);
  let render: Record<string, unknown>;
  if (item.protocol === 'encode_delay_retrieve') {
    const probes = (payload.probes as { options: unknown[] }[]).map((pr, i) => ({ ...pr, options: permute(pr.options, perms[i]) }));
    // On resume, already-answered probes are skipped and the encode phase is never shown twice.
    const answered = await q<{ probe_index: number }>("SELECT probe_index FROM responses WHERE administration_id=$1 AND phase='retrieve'", [a.administration_id], c);
    render = { ...payload, probes, answered_probes: answered.map((x) => x.probe_index) };
  } else {
    render = { ...payload, options: permute(payload.options as unknown[], perms[0]) };
  }
  return { ...base, render };
}

async function progress(c: Db, s: SessionRow) {
  const ab = await abilities(c, s.session_id);
  const n = await q1<{ n: number; live: number }>("SELECT count(*)::int AS n, count(*) FILTER (WHERE source='live')::int AS live FROM administrations WHERE session_id=$1", [s.session_id], c);
  const live = s.mode === 'live';
  const ready = live ? await q<{ plugin_id: string; n: number }>("SELECT plugin_id, count(*)::int AS n FROM session_buffer WHERE session_id=$1 AND state='ready' GROUP BY 1", [s.session_id], c) : [];
  const g = s.block_plan.global;
  return {
    served: n?.n ?? 0,
    live_served: n?.live ?? 0,
    max_items: g.max_items,
    // Without an adaptive block the length is fixed; with one, max_items is a ceiling and it may stop earlier.
    fixed_length: !s.block_plan.blocks.some((b) => b.kind === 'adaptive'),
    block_index: s.engine_state.block_index,
    blocks: s.block_plan.blocks.filter((b) => b.kind !== 'delayed_probe').length,
    elapsed_s: Math.round((Date.now() - new Date(s.started_at).getTime()) / 1000),
    mode: s.mode,
    domains: s.engine_state.domains.map((d) => {
      const pl = plugin(d);
      const e = ab[primaryDim(pl)];
      const st = s.engine_state.per_domain[d]!;
      const target_se = pl.manifest.target_se ?? g.target_se;
      const base = { plugin: d, name: pl.manifest.scoring.report_label, n: st.n, se: e?.se ?? 1, target_se, unmeasured: !!s.engine_state.unmeasured[d] };
      if (!live) return base;
      const r = ready.find((x) => x.plugin_id === d)?.n ?? 0;
      const flight = inFlightCount(s.session_id, d);
      const plan = domainPlan({ plugin_id: d, ready: r, in_flight: flight, served: st.n, answered: st.n, theta: e?.theta ?? 0, se: e?.se ?? 1, target_se, max_items: g.max_per_domain, estimated: e?.method === 'eap', recent_accuracy: null, unmeasured: base.unmeasured });
      return { ...base, ready: r, generating: flight, plan: plan.level, plan_reason: plan.reason };
    }),
  };
}

// ── Responses (choice-style items) ────────────────────────────────────────────────────
export async function respond(sessionId: string, body: unknown) {
  const parsed = ResponseSubmissionSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, 'invalid_response', 'response failed validation', parsed.error.issues);
  const r = parsed.data;
  return tx(async (c) => {
    const s = await lockSession(c, sessionId);
    const a = await q1<AdminRow>('SELECT * FROM administrations WHERE administration_id=$1 AND session_id=$2', [r.administration_id, sessionId], c);
    if (!a) throw new HttpError(404, 'administration_not_found', 'administration does not belong to this session');
    const dup = await q1<{ response_uuid: string }>('SELECT response_uuid FROM responses WHERE response_uuid=$1', [r.response_uuid], c);
    if (dup) return { recorded: true, duplicate: true, complete: a.state === 'answered' };
    const item = (await getItem(a.item_id, c))!;
    if (item.protocol === 'timed_block') throw new HttpError(400, 'use_block_endpoint', 'timed blocks are submitted to /blocks/:id/complete');
    if (r.phase === 'delay' || r.phase === 'encode') {
      await q('INSERT INTO responses (response_uuid, administration_id, phase, probe_index, raw_input, rt_ms, rt_source, timing_quality, client_clock_offset_ms, focus_lost_ms, input_device) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [r.response_uuid, a.administration_id, r.phase, r.probe_index, r.raw_input, r.rt_ms, r.rt_source, r.timing_quality, r.client_clock_offset_ms, r.focus_lost_ms, r.input_device], c);
      return { recorded: true, complete: false };
    }
    if (a.state !== 'served') throw new HttpError(409, 'already_answered', 'this administration is already complete');
    const answered = await q1('SELECT 1 FROM responses WHERE administration_id=$1 AND phase=$2 AND probe_index=$3', [a.administration_id, r.phase, r.probe_index], c);
    if (answered) throw new HttpError(409, 'probe_already_answered', 'this probe already has a response');
    const perm = a.option_order[r.probe_index];
    if (!perm) throw new HttpError(400, 'bad_probe_index', 'probe_index out of range');
    const displayed = 'choice' in r.raw_input ? r.raw_input.choice : null;
    if (displayed !== null && (displayed < 0 || displayed >= perm.length)) throw new HttpError(400, 'bad_choice', 'choice out of range');
    const original = displayed === null ? null : perm[displayed]!;
    const key = item.answer_key as { kind: string; value: number | number[] };
    const keyFor = key.kind === 'index' ? (key.value as number) : (key.value as number[])[r.probe_index];
    const correct = original !== null && original === keyFor;
    await q('INSERT INTO responses (response_uuid, administration_id, phase, probe_index, raw_input, scored_correct, rt_ms, rt_source, timing_quality, client_clock_offset_ms, focus_lost_ms, input_device) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [r.response_uuid, a.administration_id, r.phase, r.probe_index, { ...r.raw_input, original }, correct, r.rt_ms, r.rt_source, r.timing_quality, r.client_clock_offset_ms, r.focus_lost_ms, r.input_device], c);

    const nProbes = a.option_order.length;
    const got = await q<{ probe_index: number; raw_input: { original: number | null }; rt_ms: number | null }>("SELECT probe_index, raw_input, rt_ms FROM responses WHERE administration_id=$1 AND phase IN ('present','retrieve') ORDER BY probe_index", [a.administration_id], c);
    const feedback = s.block_plan.global.reveal_feedback ? { correct } : undefined;
    if (got.length < nProbes) return { recorded: true, complete: false, feedback };

    // All probes in: score with the plugin, update θ, persist.
    const { tt } = taskType(a.task_type);
    const sc = tt.scoring.scoreChoice!({ item: { ...item, task_type: item.task_type } as never, levers: item.levers as never, answers: got.map((x) => ({ probe_index: x.probe_index, choice: x.raw_input.original, rt_ms: x.rt_ms })) });
    const tl = Number((item.response_spec as { time_limit_ms?: number; per_probe_limit_ms?: number }).time_limit_ms ?? (item.response_spec as { per_probe_limit_ms?: number }).per_probe_limit_ms ?? 0) || null;
    const rts = got.map((x) => x.rt_ms).filter((x): x is number => x !== null);
    const meanRt = rts.length ? rts.reduce((x, y) => x + y, 0) / rts.length : null;
    await q("UPDATE administrations SET state='answered', scored_at=now(), score=$2 WHERE administration_id=$1",
      [a.administration_id, { kind: 'choice', u: sc.u, correct: sc.correct, per_probe: sc.per_probe, derived: sc.derived, rt_ms: meanRt, pace: meanRt && tl ? meanRt / tl : null }], c);
    await q('UPDATE item_stats SET n_administered = n_administered + 1, n_correct = n_correct + $2 WHERE item_id=$1', [a.item_id, sc.u], c);
    await recomputeAbility(c, s, Object.keys(loadingsFor(plugin(a.plugin_id), a.task_type)));
    await saveState(c, s);
    if (s.mode === 'live') setTimeout(() => void policyTick(s.session_id), 0);
    return { recorded: true, complete: true, feedback };
  });
}

// ── Timed blocks ──────────────────────────────────────────────────────────────────────
/** Server-side cross-checks on a submitted block (Doc 09 §7.7). The client is not trusted. */
export function crossCheck(spec: BlockSpec, expectedHash: string, sub: BlockSubmission): { ok: boolean; checks: Record<string, boolean | string> } {
  const byIdx = new Map(spec.trials.map((t) => [t.index, t]));
  const allowed = new Set(spec.responses.map((r) => r.id));
  const idx = sub.trials.map((t) => t.index);
  const onsets = sub.trials.map((t) => t.onset_ms);
  const rts = sub.trials.map((t) => t.rt_ms).filter((x): x is number => x !== null);
  const spanMs = onsets.length ? Math.max(...onsets) - Math.min(...onsets) : 0;
  const checks: Record<string, boolean | string> = {
    sequence_hash: sub.sequence_hash === expectedHash,
    trial_count: sub.trials.length <= spec.trials.length,
    indices_known_unique: idx.every((i) => byIdx.has(i)) && new Set(idx).size === idx.length,
    monotonic_timestamps: idx.every((v, i) => i === 0 || v > idx[i - 1]!) && onsets.every((v, i) => i === 0 || v >= onsets[i - 1]!),
    wall_time_consistent: spanMs <= sub.wall_ms + 2000,
    responses_allowed: sub.trials.every((t) => t.response === null || allowed.has(t.response)),
    rt_floor: rts.filter((x) => x < 100).length <= Math.max(1, 0.1 * rts.length),
    rt_within_window: sub.trials.every((t) => t.rt_ms === null || t.rt_ms <= (byIdx.get(t.index)?.response_window_ms ?? 60_000) + 50),
  };
  return { ok: Object.values(checks).every((v) => v === true), checks };
}

export async function completeBlock(sessionId: string, adminId: string, body: unknown) {
  const parsed = BlockSubmissionSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, 'invalid_block', 'block submission failed validation', parsed.error.issues);
  const sub = parsed.data;
  return tx(async (c) => {
    const s = await lockSession(c, sessionId);
    const a = await q1<AdminRow>('SELECT * FROM administrations WHERE administration_id=$1 AND session_id=$2 FOR UPDATE', [adminId, sessionId], c);
    if (!a) throw new HttpError(404, 'administration_not_found', 'administration does not belong to this session');
    const prior = await q1<{ verdict: string }>('SELECT verdict FROM block_submissions WHERE administration_id=$1 AND attempt=$2', [adminId, sub.attempt], c);
    if (prior) return { recorded: true, duplicate: true, verdict: prior.verdict };
    if (a.state !== 'served') throw new HttpError(409, 'already_complete', 'this block is already complete');
    const bs = a.block_state!;
    if (sub.attempt !== Number(bs.attempt)) throw new HttpError(409, 'attempt_mismatch', `expected attempt ${bs.attempt}`);
    const item = (await getItem(a.item_id, c))!;
    const spec = expandBlock(a.task_type, item, Number(bs.seed), s.engine_state.time_scale);
    if (sub.device_profile && !s.device_profile) await q('UPDATE sessions SET device_profile=$2 WHERE session_id=$1', [sessionId, sub.device_profile], c);
    const record = async (verdict: string, checks: unknown) =>
      q('INSERT INTO block_submissions (administration_id, attempt, status, payload, checks, verdict) VALUES ($1,$2,$3,$4,$5,$6)', [adminId, sub.attempt, sub.status, sub, checks, verdict], c);

    const reoffer = async (reason: string, checks: unknown) => {
      await record(`reoffer:${reason}`, checks);
      if (sub.attempt >= 2) {
        await q("UPDATE administrations SET state='unmeasured', scored_at=now(), score=$2 WHERE administration_id=$1", [adminId, { kind: 'block', unmeasured: true, reason }], c);
        await saveState(c, s);
        return { recorded: true, verdict: 'unmeasured', reason };
      }
      const seed = Number(bs.seed) + 1;
      const again = expandBlock(a.task_type, item, seed, s.engine_state.time_scale);
      await q('UPDATE administrations SET block_state=$2 WHERE administration_id=$1', [adminId, { ...bs, attempt: 2, seed, sequence_hash: sequenceHash(again), first_attempt_reason: reason }], c);
      return { recorded: true, verdict: 'reoffer', reason };
    };

    const cc = crossCheck(spec, String(bs.sequence_hash), sub);
    if (!cc.ok) {
      await record('quarantined', cc.checks);
      await q("UPDATE administrations SET state='unmeasured', scored_at=now(), score=$2 WHERE administration_id=$1", [adminId, { kind: 'block', unmeasured: true, reason: 'server_cross_check_failed', checks: cc.checks }], c);
      await audit('engine', 'block_quarantined', 'administration', adminId, cc.checks, c);
      return { recorded: true, verdict: 'quarantined', checks: cc.checks };
    }
    if (sub.status === 'aborted') return reoffer(sub.abort_reason ?? 'aborted', cc.checks);
    const n = sub.trials.length || 1;
    const degraded = sub.trials.filter((t) => t.timing_quality === 'degraded').length / n;
    const unusable = sub.trials.filter((t) => t.timing_quality === 'unusable').length / n;
    if (degraded + unusable > 0.25) return reoffer('timing_quality', { ...cc.checks, degraded, unusable });
    if (degraded > 0.1) return reoffer('degraded_trials', { ...cc.checks, degraded });

    const { plugin: pl, tt } = taskType(a.task_type);
    // Raw RTs are scored; the device's estimated input latency is stored alongside so both raw and
    // corrected values can be reported (Doc 09 §7.6).
    // Trials whose onset falls after a time-limited block's end do not count (anti-tamper; Doc 09 §7.7).
    const limitMs = spec.duration_s ? spec.duration_s * 1000 + 1000 : Infinity;
    const results: TrialResult[] = sub.trials.filter((t) => t.onset_ms <= limitMs);
    const score = tt.scoring.scoreBlock!({ block: spec, levers: item.levers as never, results, baseline: { simple_rt_median_ms: s.engine_state.baseline.simple_rt_median_ms } });
    if (!score.valid) return reoffer(score.invalid_reason ?? 'invalid', { ...cc.checks, invalid: score.invalid_reason });

    const norm = tt.def.block_norm!;
    const z = (score.metric - norm.mu) / norm.sigma * (norm.direction === 'lower_is_better' ? -1 : 1);
    const perf = Math.max(-4, Math.min(4, item.difficulty_b + z));
    const sdObs = blockSd(item.discrimination_a, norm.difference_score);
    await record('scored', cc.checks);
    await q("UPDATE administrations SET state='answered', scored_at=now(), score=$2 WHERE administration_id=$1", [adminId, {
      kind: 'block', metric: score.metric, metric_name: norm.metric, perf, s: sdObs, z, accuracy: score.accuracy, counts: score.counts, derived: score.derived,
      provisional_norm: norm.provisional, input_device: sub.input_device, attempt: sub.attempt, latency_correction_ms: sub.device_profile?.input_latency_ms ?? null,
    }], c);
    await q('UPDATE item_stats SET n_administered = n_administered + 1, n_correct = n_correct + $2 WHERE item_id=$1', [a.item_id, Math.max(0, Math.min(1, 0.5 + z / 4))], c);
    if (pl.manifest.mandatory_task_types.includes(a.task_type) && typeof score.derived.median_rt_ms === 'number') s.engine_state.baseline.simple_rt_median_ms = score.derived.median_rt_ms;
    await recomputeAbility(c, s, Object.keys(loadingsFor(pl, a.task_type)));
    await saveState(c, s);
    if (s.mode === 'live') setTimeout(() => void policyTick(s.session_id), 0);
    return { recorded: true, verdict: 'scored' };
  });
}

// ── Delayed-recall probes ─────────────────────────────────────────────────────────────
async function probeCapture(c: Db, s: SessionRow) {
  const st = s.engine_state;
  const probeBlock = s.block_plan.blocks.find((b) => b.kind === 'delayed_probe');
  const owner = st.domains.map((d) => plugin(d)).find((p) => p.manifest.cross_session?.enabled && p.crossSession && !st.unmeasured[p.manifest.plugin_id]);
  if (!probeBlock || !owner) { st.probes_offered = true; await saveState(c, s); return null; }
  const cs = owner.manifest.cross_session!;
  const open = await q1<{ n: number }>("SELECT count(*)::int AS n FROM recall_probes WHERE subject_id=$1 AND state IN ('pending','due')", [s.subject_id], c);
  const count = Math.min(probeBlock.max_probes ?? 3, cs.max_open_probes - (open?.n ?? 0));
  st.probes_offered = true;
  await saveState(c, s);
  if (count <= 0) return null;
  const ab = await abilities(c, s.session_id);
  const tt = owner.manifest.task_types.find((t) => t.id === cs.task_type)!;
  const levers = resolveLevers(owner.manifest, tt, ab[primaryDim(owner)]?.theta ?? 0);
  const rng = createRng(seed32());
  const [lo, hi] = probeBlock.delay_days ?? cs.delay_days_range;
  const qs = owner.crossSession!.probes({ specificity: levers.specificity as 'general', rng, count });
  const out: { probe_id: string; question: string }[] = [];
  for (const x of qs) {
    const id = uuid();
    const days = Math.round(lo + rng.next() * (hi - lo));
    await q("INSERT INTO recall_probes (probe_id, subject_id, session_id, question, specificity, asked_at, due_at, delete_after, state) VALUES ($1,$2,$3,$4,$5,now(), now() + make_interval(days => $6), now() + interval '90 days', 'awaiting_answer')",
      [id, s.subject_id, s.session_id, x.question, x.specificity, days], c);
    out.push({ probe_id: id, question: x.question });
  }
  return { kind: 'probe_capture' as const, plugin: { id: owner.manifest.plugin_id, name: owner.manifest.scoring.report_label }, questions: out, note: 'We will ask these again in a week or two. Answers are encrypted and deleted after the follow-up.' };
}

export async function submitProbeAnswers(sessionId: string, body: { answers?: { probe_id: string; answer: string | null }[] }) {
  const answers = (body.answers ?? []).slice(0, 5);
  for (const a of answers) {
    if (typeof a.probe_id !== 'string') continue;
    const text = typeof a.answer === 'string' ? a.answer.trim().slice(0, 500) : '';
    if (!text) await q("DELETE FROM recall_probes WHERE probe_id=$1 AND session_id=$2 AND state='awaiting_answer'", [a.probe_id, sessionId]);
    else await q("UPDATE recall_probes SET stored_answer = pgp_sym_encrypt($3, $4), state='pending' WHERE probe_id=$1 AND session_id=$2 AND state='awaiting_answer'", [a.probe_id, sessionId, text, config.PROBE_ENCRYPTION_KEY]);
  }
  await q("DELETE FROM recall_probes WHERE session_id=$1 AND state='awaiting_answer'", [sessionId]);
  return { recorded: true };
}

export async function dueProbes(subjectId: string) {
  return q("SELECT probe_id, question, due_at FROM recall_probes WHERE subject_id=$1 AND state IN ('pending','due') AND due_at <= now() ORDER BY due_at", [subjectId]);
}

export async function respondProbe(probeId: string, body: { answer?: string }) {
  const answer = typeof body.answer === 'string' ? body.answer.trim().slice(0, 500) : '';
  return tx(async (c) => {
    const p = await q1<{ probe_id: string; subject_id: string; session_id: string; stored: string; state: string; due_at: Date }>(
      "SELECT probe_id, subject_id, session_id, pgp_sym_decrypt(stored_answer, $2) AS stored, state, due_at FROM recall_probes WHERE probe_id=$1 FOR UPDATE", [probeId, config.PROBE_ENCRYPTION_KEY], c);
    if (!p) throw new HttpError(404, 'probe_not_found', 'unknown probe');
    if (!['pending', 'due'].includes(p.state)) throw new HttpError(409, 'probe_closed', 'this probe is closed');
    if (new Date(p.due_at).getTime() > Date.now()) throw new HttpError(409, 'probe_not_due', 'this probe is not due yet');
    const owner = [...registry().plugins.values()].find((x) => x.crossSession)!;
    const g = owner.crossSession!.match(p.stored, answer);
    // Raw response stored (encrypted) so a human can audit the grade; hard-deleted by W4 after scoring.
    await q("UPDATE recall_probes SET response_answer = pgp_sym_encrypt($2, $3), grade=$4, retrieval_score=$5, reprobed_at=now(), state='scored', delete_after = now() + interval '7 days' WHERE probe_id=$1",
      [probeId, answer || '(no answer)', config.PROBE_ENCRYPTION_KEY, g.grade, g.score], c);
    await audit('subject', 'probe_answered', 'probe', probeId, { grade: g.grade }, c);
    return { recorded: true, grade: g.grade };
  });
}

// ── State ─────────────────────────────────────────────────────────────────────────────
export async function sessionState(sessionId: string) {
  const s = await q1<SessionRow>('SELECT * FROM sessions WHERE session_id=$1', [sessionId]);
  if (!s) throw new HttpError(404, 'session_not_found', 'unknown session');
  return {
    session_id: s.session_id,
    phase: s.phase,
    battery_id: s.battery_id,
    stop_reason: s.stop_reason,
    progress: await progress(pool, s),
    abilities: await abilities(pool, sessionId),
    unmeasured: s.engine_state.unmeasured,
    substitutions: s.engine_state.substitutions,
  };
}

export const __internal = { decide, optionPermutations };
