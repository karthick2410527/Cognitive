// Live, per-session question generation.
//
//  • At session start every domain gets `initial_per_domain` questions generated in real time
//    (Gemini, through the same four-layer prompt and five gates as the bank) into a session buffer.
//    Each of those is retried with a different task type until it passes the gates (bounded).
//  • After that a GenerationPolicy decides, per domain, how much more to generate. The threshold
//    policy works on each domain's standard error: uncertain domains get more, converging domains
//    less, and domains already measured to their target get none. The `external` policy asks
//    another system instead, behind the same interface.
//  • A modality balancer keeps the session near the configured text/visual ratio (70/30), choosing a
//    task type that supports the wanted modality when the domain has one.
//  • Generated items are banked too, so a live question also serves future users.
import { z } from 'zod';
import { SubjectProfileSchema, type LoadedPlugin } from '@cognimetric/core';
import { q, q1, type Db } from '../db/pool';
import { accessibleTaskTypes } from '../engine/selection';
import { generateNow } from '../generation/service';
import { providerDegraded } from '../llm';
import { registry } from '../plugins/registry';
import { log } from '../util';
import { generationConfig } from './config';

export type Modality = 'text' | 'visual';

export interface DomainState { plugin_id: string; ready: number; in_flight: number; served: number; answered: number; theta: number; se: number; target_se: number; max_items: number; estimated: boolean; recent_accuracy: number | null; unmeasured: boolean }
export interface PolicyInput { session_id: string; phase: string; domains: DomainState[]; modality: { text: number; visual: number; target_text_share: number } }
export interface GenRequest { plugin_id: string; count: number; target_b: number; modality?: Modality; task_type?: string; avoid?: string[]; reason: string }
export interface GenerationPolicy { name: string; decide(input: PolicyInput): Promise<GenRequest[]> }

// ── Policies ──────────────────────────────────────────────────────────────────────────
export type Level = 'more' | 'normal' | 'none';
export interface DomainPlan { plugin_id: string; level: Level; keep_ready: number; refill: number; reason: string }

/** How much the threshold policy wants for one domain, from its SE and what it has left. */
export function domainPlan(d: DomainState): DomainPlan {
  const t = generationConfig().policy.threshold;
  const o = t.per_domain[d.plugin_id] ?? {};
  const none = (reason: string): DomainPlan => ({ plugin_id: d.plugin_id, level: 'none', keep_ready: 0, refill: 0, reason });
  if (d.unmeasured) return none('not measured in this session');
  if (o.enabled === false) return none('turned off in the config');
  if (d.served >= (d.max_items ?? Infinity)) return none(`reached its limit of ${d.max_items} questions`);
  if (t.stop_when_target_se_met && d.estimated && d.se <= d.target_se) return none(`SE ${d.se.toFixed(2)} ≤ target ${d.target_se}`);
  const more = { ...t.more, ...o.more };
  if (!d.estimated || d.se > more.se_above) {
    return { plugin_id: d.plugin_id, level: 'more', keep_ready: more.keep_ready, refill: more.refill, reason: d.estimated ? `SE ${d.se.toFixed(2)} > ${more.se_above}` : 'no score yet' };
  }
  const normal = { ...t.normal, ...o.normal };
  return { plugin_id: d.plugin_id, level: 'normal', keep_ready: normal.keep_ready, refill: normal.refill, reason: `SE ${d.se.toFixed(2)} between target ${d.target_se} and ${more.se_above}` };
}

export const thresholdPolicy: GenerationPolicy = {
  name: 'threshold',
  async decide(input) {
    const t = generationConfig().policy.threshold;
    let budget = t.max_in_flight_per_session - input.domains.reduce((s, d) => s + d.in_flight, 0);
    const rank: Record<Level, number> = { more: 0, normal: 1, none: 2 };
    const plans = input.domains.map((d) => ({ d, p: domainPlan(d) }));
    const out: GenRequest[] = [];
    // Neediest first: "more" domains, then the biggest shortfall, then the widest uncertainty.
    plans.sort((a, b) => rank[a.p.level] - rank[b.p.level] || (b.p.keep_ready - b.d.ready - b.d.in_flight) - (a.p.keep_ready - a.d.ready - a.d.in_flight) || b.d.se - a.d.se);
    for (const { d, p } of plans) {
      if (p.level === 'none' || budget <= 0) continue;
      const have = d.ready + d.in_flight;
      if (have >= p.keep_ready) continue;
      const count = Math.min(p.refill, budget, Math.max(0, (d.max_items ?? Infinity) - d.served - have));
      if (count <= 0) continue;
      out.push({ plugin_id: d.plugin_id, count, target_b: clamp(d.theta), reason: `${p.level}: ${p.reason}; ready ${d.ready} + in flight ${d.in_flight} < ${p.keep_ready}` });
      budget -= count;
    }
    return out;
  },
};

const ExternalResponse = z.object({
  requests: z.array(z.object({ plugin_id: z.string(), count: z.number().int().min(1).max(8), target_b: z.number().min(-3).max(3), modality: z.enum(['text', 'visual']).optional(), task_type: z.string().optional() })).max(20),
});

/** Asks another system which questions to generate next. Falls back to the threshold policy. */
export const externalPolicy: GenerationPolicy = {
  name: 'external',
  async decide(input) {
    const cfg = generationConfig().policy.external;
    if (!cfg.url) return thresholdPolicy.decide(input);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), cfg.timeout_ms);
    try {
      const res = await fetch(cfg.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: ctl.signal });
      const parsed = ExternalResponse.safeParse(await res.json());
      if (!res.ok || !parsed.success) throw new Error(`bad response (HTTP ${res.status})`);
      const known = new Set(input.domains.map((d) => d.plugin_id));
      return parsed.data.requests.filter((r) => known.has(r.plugin_id)).map((r) => ({ ...r, reason: 'external policy' }));
    } catch (e) {
      log('live', `external policy failed: ${(e as Error).message}${cfg.fallback_to_threshold ? ' — using threshold policy' : ''}`);
      return cfg.fallback_to_threshold ? thresholdPolicy.decide(input) : [];
    } finally {
      clearTimeout(timer);
    }
  },
};

export const policy = (): GenerationPolicy => (generationConfig().policy.kind === 'external' ? externalPolicy : thresholdPolicy);
const clamp = (b: number) => Math.max(-3, Math.min(3, Math.round(b * 4) / 4));

// ── In-flight tracking and a global concurrency cap on provider calls ─────────────────
const inFlight = new Map<string, Set<Promise<unknown>>>(); // `${session}|${plugin}` → running generations
const key = (s: string, p: string) => `${s}|${p}`;
const MAX_CONCURRENT = Number(process.env.LIVE_MAX_CONCURRENT ?? 8);
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r));
  running++;
  try { return await fn(); } finally { running--; waiting.shift()?.(); }
}

export function inFlightCount(sessionId: string, pluginId: string) {
  return inFlight.get(key(sessionId, pluginId))?.size ?? 0;
}

// ── Modality balancing and task-type choice ───────────────────────────────────────────
async function sessionModalityCounts(sessionId: string, db?: Db) {
  const r = await q1<{ text: number; visual: number }>(
    `SELECT count(*) FILTER (WHERE modality='text')::int AS text, count(*) FILTER (WHERE modality='visual')::int AS visual FROM (
       SELECT modality FROM administrations WHERE session_id=$1 AND modality IS NOT NULL
       UNION ALL SELECT modality FROM session_buffer WHERE session_id=$1 AND state='ready'
       UNION ALL SELECT modality FROM generation_jobs WHERE session_id=$1 AND state IN ('queued','running') AND modality IS NOT NULL) x`, [sessionId], db);
  return { text: r?.text ?? 0, visual: r?.visual ?? 0 };
}

/** Task types this session's user was served in their previous sessions (last 30 days). */
export async function userHistory(sessionId: string, db?: Db): Promise<Map<string, number>> {
  const rows = await q<{ task_type: string; n: number }>(
    `SELECT a.task_type, count(*)::int AS n FROM administrations a JOIN sessions s ON s.session_id = a.session_id
     WHERE s.user_id = (SELECT user_id FROM sessions WHERE session_id=$1) AND s.user_id IS NOT NULL AND a.session_id <> $1
       AND a.served_at > now() - interval '30 days' GROUP BY a.task_type`, [sessionId], db);
  return new Map(rows.map((r) => [r.task_type, r.n]));
}

export async function chooseTaskType(sessionId: string, plugin: LoadedPlugin, wanted?: Modality, forced?: string, avoid: string[] = []): Promise<{ task_type: string; modality: Modality } | null> {
  const s = await q1<{ flags: { profile_snapshot?: unknown } }>('SELECT flags FROM sessions WHERE session_id=$1', [sessionId]);
  const profile = SubjectProfileSchema.parse(s?.flags.profile_snapshot ?? {});
  const allowed = new Set(accessibleTaskTypes(plugin, profile).allowed);
  const m = plugin.manifest;
  const used = await q<{ task_type: string; n: number }>(
    `SELECT task_type, count(*)::int AS n FROM (SELECT task_type FROM administrations WHERE session_id=$1 UNION ALL SELECT task_type FROM session_buffer WHERE session_id=$1 AND state='ready'
       UNION ALL SELECT task_type FROM generation_jobs WHERE session_id=$1 AND state IN ('queued','running')) x GROUP BY task_type`, [sessionId]);
  const usedOf = (t: string) => used.find((u) => u.task_type === t)?.n ?? 0;
  const seen = await userHistory(sessionId);
  const seenOf = (t: string) => seen.get(t) ?? 0;
  // Written slots: the free-form question writer, where the config turns it on for this domain.
  const written = generationConfig().written;
  const freeform = m.task_types.find((t) => t.generation === 'freeform' && allowed.has(t.id));
  if (freeform && written.source === 'freeform' && (written.domains === null || written.domains.includes(m.plugin_id)) && (forced === freeform.id || (!forced && wanted === 'text'))) {
    return { task_type: freeform.id, modality: 'text' };
  }
  const eligible = m.task_types.filter((t) => allowed.has(t.id) && t.weight > 0 && t.protocol !== 'cross_session' && t.generation !== 'freeform');
  // A retry avoids the task types that just failed, when the domain has another.
  const types = eligible.filter((t) => !avoid.includes(t.id)).length ? eligible.filter((t) => !avoid.includes(t.id)) : eligible;
  if (!types.length) return null;
  if (forced) {
    const t = types.find((x) => x.id === forced);
    if (t) return { task_type: t.id, modality: wanted && t.modalities.includes(wanted) ? wanted : t.modalities[0]! };
  }
  // A mandatory task type (e.g. the simple-RT motor baseline) is generated first — unless this request
  // asks for a modality it cannot provide (the initial plan gives that domain's other slot a written question).
  const mandatory = types.find((t) => m.mandatory_task_types.includes(t.id) && usedOf(t.id) === 0 && (!wanted || t.modalities.includes(wanted)));
  if (mandatory) return { task_type: mandatory.id, modality: mandatory.modalities[0]! };
  const cfg = generationConfig();
  let target: Modality = wanted ?? 'text';
  if (!wanted) {
    const c = await sessionModalityCounts(sessionId);
    const total = c.text + c.visual;
    target = total === 0 ? (Math.random() < cfg.modality_ratio.text ? 'text' : 'visual') : c.text / total < cfg.modality_ratio.text ? 'text' : 'visual';
  }
  const pool = types.filter((t) => t.modalities.includes(target));
  const pick = (pool.length ? pool : types);
  // Content balance: weight ÷ (1 + used in this session + ½ × served to this user in recent sessions),
  // so the same task type does not open every session.
  const scored = pick.map((t) => ({ t, w: t.weight / (1 + usedOf(t.id) + 0.5 * seenOf(t.id)) }));
  const total = scored.reduce((s2, x) => s2 + x.w, 0);
  let r = Math.random() * total;
  const chosen = scored.find((x) => (r -= x.w) <= 0)?.t ?? scored[0]!.t;
  return { task_type: chosen.id, modality: chosen.modalities.includes(target) ? target : chosen.modalities[0]! };
}

// ── Generation into the buffer ────────────────────────────────────────────────────────
export interface GenOutcome { added: number; task_type: string | null }

function track(k: string, p: Promise<unknown>) {
  const set = inFlight.get(k) ?? new Set();
  set.add(p);
  inFlight.set(k, set);
  void p.finally(() => { set.delete(p); });
}

export function generateForSession(sessionId: string, locale: string, req: GenRequest, tracked = true): Promise<GenOutcome> {
  const plugin = registry().plugins.get(req.plugin_id);
  if (!plugin) return Promise.resolve({ added: 0, task_type: null });
  let chosen: string | null = null;
  const p = slot(async () => {
    const choice = await chooseTaskType(sessionId, plugin, req.modality, req.task_type, req.avoid);
    if (!choice) return { added: 0, task_type: null };
    chosen = choice.task_type;
    const written = generationConfig().written;
    const freeform = plugin.taskTypes.get(choice.task_type)?.def.generation === 'freeform' && written.reuse_stored;
    const reuse = async (n: number, why: string) => {
      const got = await reuseStored(sessionId, req.plugin_id, choice.task_type, req.target_b, n);
      if (got) log('live', `session ${sessionId.slice(0, 8)} ${req.plugin_id}/${choice.task_type} b=${req.target_b}: +${got} reused from the bank (${why}) — ${req.reason}`);
      return got;
    };
    // stored_first: unseen stored free-form questions before anything new is written.
    if (freeform && written.order === 'stored_first') {
      const got = await reuse(req.count, 'stored first');
      if (got >= req.count) return { added: got, task_type: choice.task_type };
    }
    const r = await generateNow({ kind: 'live', pluginId: req.plugin_id, taskType: choice.task_type, locale, targetB: req.target_b, requested: req.count, modality: choice.modality, sessionId });
    const serveUnreviewed = generationConfig().serve_unreviewed_live_items;
    let added = 0;
    for (const it of r.items) {
      if (!it.live && !serveUnreviewed) continue;
      await q("INSERT INTO session_buffer (session_id, plugin_id, task_type, item_id, modality, target_b, job_id) VALUES ($1,$2,$3,$4,$5,$6,(SELECT provenance->>'job_id' FROM items WHERE item_id=$4)::uuid)",
        [sessionId, req.plugin_id, choice.task_type, it.item_id, r.modality, req.target_b]);
      added++;
    }
    log('live', `session ${sessionId.slice(0, 8)} ${req.plugin_id}/${choice.task_type} (${r.modality}) b=${req.target_b}: +${added} buffered, ${r.rejected} rejected — ${req.reason}`);
    // generate_first: when writing fell short, fall back to unseen stored questions of this type.
    if (freeform && written.order === 'generate_first' && added < req.count) added += await reuse(req.count - added, 'generation fell short');
    return { added, task_type: choice.task_type };
  }).catch((e) => { log('live', `generation failed for ${req.plugin_id}: ${(e as Error).message}`); return { added: 0, task_type: chosen }; });
  if (tracked) track(key(sessionId, req.plugin_id), p);
  return p;
}

/**
 * Puts up to `count` banked questions of this task type into the session buffer: near the target
 * difficulty (±0.75), never seen by this user in any session, not already buffered. Returns how many.
 */
export async function reuseStored(sessionId: string, pluginId: string, taskType: string, targetB: number, count: number): Promise<number> {
  const statuses = generationConfig().serve_unreviewed_live_items ? ['live', 'validated'] : ['live'];
  const rows = await q<{ item_id: string; modality: string | null }>(
    `SELECT i.item_id, i.modality FROM items i
     WHERE i.plugin_id=$2 AND i.task_type=$3 AND i.status = ANY($6) AND abs(i.difficulty_b - $4) <= 0.75
       AND i.locale = (SELECT locale FROM sessions WHERE session_id=$1)
       AND NOT EXISTS (SELECT 1 FROM administrations a JOIN sessions s2 ON s2.session_id=a.session_id
                       WHERE a.item_id=i.item_id AND (a.session_id=$1 OR s2.user_id=(SELECT user_id FROM sessions WHERE session_id=$1)))
       AND NOT EXISTS (SELECT 1 FROM session_buffer b WHERE b.session_id=$1 AND b.item_id=i.item_id)
     ORDER BY abs(i.difficulty_b - $4), random() LIMIT $5`,
    [sessionId, pluginId, taskType, targetB, count, statuses]);
  for (const r of rows) {
    await q("INSERT INTO session_buffer (session_id, plugin_id, task_type, item_id, modality, target_b, job_id) VALUES ($1,$2,$3,$4,$5,$6,NULL)",
      [sessionId, pluginId, taskType, r.item_id, r.modality ?? 'text', targetB]);
  }
  return rows.length;
}

/**
 * Puts up to `count` stored questions of one modality into the buffer: any task type this user may
 * take in the domain, near the target difficulty first, never seen by this user, not already buffered.
 * These are served as fallback (source 'bank_fallback'), not as freshly written.
 */
export async function fillFromStored(sessionId: string, pluginId: string, modality: Modality, targetB: number, count: number): Promise<number> {
  const p = registry().plugins.get(pluginId);
  if (!p || count <= 0) return 0;
  const s = await q1<{ flags: { profile_snapshot?: unknown } }>('SELECT flags FROM sessions WHERE session_id=$1', [sessionId]);
  const allowed = accessibleTaskTypes(p, SubjectProfileSchema.parse(s?.flags.profile_snapshot ?? {})).allowed
    .filter((t) => { const def = p.manifest.task_types.find((x) => x.id === t); return def && def.protocol !== 'cross_session' && def.modalities.includes(modality); });
  if (!allowed.length) return 0;
  const statuses = generationConfig().serve_unreviewed_live_items ? ['live', 'validated'] : ['live'];
  const rows = await q<{ item_id: string; task_type: string; modality: string | null }>(
    `SELECT i.item_id, i.task_type, i.modality FROM items i
     WHERE i.plugin_id=$2 AND i.task_type = ANY($3) AND i.status = ANY($6) AND coalesce(i.modality, $7) = $7
       AND i.locale = (SELECT locale FROM sessions WHERE session_id=$1)
       AND NOT EXISTS (SELECT 1 FROM administrations a JOIN sessions s2 ON s2.session_id=a.session_id
                       WHERE a.item_id=i.item_id AND (a.session_id=$1 OR s2.user_id=(SELECT user_id FROM sessions WHERE session_id=$1)))
       AND NOT EXISTS (SELECT 1 FROM session_buffer b WHERE b.session_id=$1 AND b.item_id=i.item_id)
     ORDER BY abs(i.difficulty_b - $4), random() LIMIT $5`,
    [sessionId, pluginId, allowed, targetB, count, statuses, modality]);
  for (const r of rows) {
    await q("INSERT INTO session_buffer (session_id, plugin_id, task_type, item_id, modality, target_b, job_id) VALUES ($1,$2,$3,$4,$5,$6,NULL)",
      [sessionId, pluginId, r.task_type, r.item_id, r.modality ?? modality, targetB]);
  }
  return rows.length;
}

/** Whether this domain's written questions come from the free-form writer. */
export function usesFreeform(pluginId: string): boolean {
  const w = generationConfig().written;
  const m = registry().plugins.get(pluginId)?.manifest;
  return !!m && w.source === 'freeform' && (w.domains === null || w.domains.includes(pluginId)) && m.task_types.some((t) => t.generation === 'freeform');
}

/**
 * Plans the modality of every initial question so the first batch already sits at the configured
 * ratio (e.g. 3 visual of 10). A domain whose mandatory first task is visual-only spends one of the
 * visual slots on it; the rest go to randomly chosen second slots.
 */
export function initialModalities(domains: string[], perDomain: number, visualShare: number): Record<string, Modality[]> {
  const plan: Record<string, Modality[]> = Object.fromEntries(domains.map((d) => [d, Array.from({ length: perDomain }, () => 'text' as Modality)]));
  let visualLeft = Math.round(domains.length * perDomain * visualShare);
  for (const d of domains) {
    const m = registry().plugins.get(d)?.manifest;
    const first = m?.task_types.find((t) => m.mandatory_task_types.includes(t.id));
    if (first && !first.modalities.includes('text') && perDomain > 0) { plan[d]![0] = 'visual'; visualLeft--; }
  }
  const open = domains.flatMap((d) => plan[d]!.map((mod, i) => ({ d, i, mod }))).filter((x) => x.mod === 'text');
  // Prefer second slots so each domain's first question is written where possible.
  open.sort((a, b) => b.i - a.i || Math.random() - 0.5);
  for (const x of open.slice(0, Math.max(0, visualLeft))) plan[x.d]![x.i] = 'visual';
  return plan;
}

/**
 * Initial buffer: `initial_per_domain` questions per domain, at the Block-0 difficulty targets.
 * A question rejected by the gates is retried with another task type, up to `initial_max_attempts`.
 * Each slot is tracked as one in-flight generation for its whole life, so a request waiting for this
 * domain keeps waiting across retries.
 */
export function startInitialBuffer(sessionId: string, locale: string, domains: string[], bTargets: number[]) {
  const cfg = generationConfig();
  const plan = initialModalities(domains, cfg.initial_per_domain, cfg.modality_ratio.visual);
  // Tops a domain up to its planned number of questions of one modality from stored, unseen questions.
  const topUp = async (d: string, modality: Modality, target_b: number, why: string) => {
    const planned = plan[d]!.filter((m) => m === modality).length;
    const have = (await q1<{ n: number }>("SELECT count(*)::int AS n FROM session_buffer WHERE session_id=$1 AND plugin_id=$2 AND modality=$3 AND state='ready'", [sessionId, d, modality]))?.n ?? 0;
    if (have >= planned) return true;
    const got = await fillFromStored(sessionId, d, modality, target_b, planned - have);
    if (got) log('live', `session ${sessionId.slice(0, 8)} ${d} (${modality}): +${got} stored, unseen — ${why}`);
    return have + got > 0;
  };
  if (providerDegraded()) {
    log('live', 'provider paused: the first questions come from stored, unseen questions');
    for (const d of domains) for (const mod of new Set(plan[d]!)) track(key(sessionId, d), topUp(d, mod, bTargets[0] ?? 0, 'provider paused'));
    return;
  }
  // One request per slot — except a free-form domain's written slots, which share one request (the
  // writer returns several questions per call), so a session start costs fewer provider calls.
  const slots: { d: string; modality: Modality; target_b: number; count: number }[] = [];
  for (const d of domains) {
    const text = plan[d]!.map((mod, i) => ({ mod, b: bTargets[i % bTargets.length] ?? 0 })).filter((x) => x.mod === 'text');
    plan[d]!.forEach((mod, i) => {
      if (mod === 'text' && usesFreeform(d) && text.length > 1) return;
      slots.push({ d, modality: mod, target_b: bTargets[i % bTargets.length] ?? 0, count: 1 });
    });
    if (usesFreeform(d) && text.length > 1) slots.push({ d, modality: 'text', target_b: text.reduce((a, x) => a + x.b, 0) / text.length, count: text.length });
  }
  for (const { d, modality, target_b, count } of slots) {
    const slotRun = (async () => {
      const avoid: string[] = [];
      for (let attempt = 1; attempt <= cfg.initial_max_attempts; attempt++) {
        if (providerDegraded()) return false;
        const reason = attempt === 1 ? 'initial buffer' : `initial buffer, retry ${attempt - 1}`;
        const r = await generateForSession(sessionId, locale, { plugin_id: d, count, target_b, modality, avoid: [...avoid], reason }, false);
        if (r.added > 0) return true;
        // A mandatory type (served first in its domain) is retried as itself until the last attempt,
        // which switches type so the domain still gets its question; others switch type at once.
        const mandatory = registry().plugins.get(d)?.manifest.mandatory_task_types ?? [];
        if (r.task_type && (!mandatory.includes(r.task_type) || attempt === cfg.initial_max_attempts - 1)) avoid.push(r.task_type);
        const s = await q1<{ phase: string }>('SELECT phase FROM sessions WHERE session_id=$1', [sessionId]);
        if (!s || s.phase === 'done') return false;
      }
      return false;
    })();
    // Whatever happens first — the question is written, the slot gives up, or the deadline passes —
    // the slot is then settled: a failed or late slot is filled from stored, unseen questions.
    // A question that is written after the deadline still lands in the buffer for later.
    const deadline = new Promise<'late'>((r) => setTimeout(() => r('late'), cfg.initial_deadline_ms));
    const settled = Promise.race([slotRun, deadline]).then(async (ok) => {
      if (ok === true) return true;
      return topUp(d, modality, target_b, ok === 'late' ? `not written within ${Math.round(cfg.initial_deadline_ms / 1000)} s` : 'writing failed');
    });
    track(key(sessionId, d), settled);
    // A slot that gave up hands over to the policy straight away rather than at the next answer.
    void slotRun.then((ok) => { if (!ok) setTimeout(() => void policyTick(sessionId), 0); });
  }
}

/** Asks the policy what to generate next and starts it (fire and forget). */
export async function policyTick(sessionId: string) {
  try {
    if (providerDegraded()) return;
    const s = await q1<PolicySession & { locale: string; mode: string }>('SELECT phase, locale, mode, engine_state, block_plan FROM sessions WHERE session_id=$1', [sessionId]);
    if (!s || s.mode !== 'live' || s.phase === 'done') return;
    const input = await policyInput(sessionId, s);
    for (const r of await policy().decide(input)) void generateForSession(sessionId, s.locale, r);
  } catch (e) {
    log('live', `policy tick failed: ${(e as Error).message}`);
  }
}

export interface PolicySession { phase: string; engine_state: { domains: string[]; unmeasured: Record<string, string> }; block_plan: { global: { target_se: number; max_per_domain: number } } }

export async function policyInput(sessionId: string, s: PolicySession): Promise<PolicyInput> {
  const buf = await q<{ plugin_id: string; ready: number }>("SELECT plugin_id, count(*)::int AS ready FROM session_buffer WHERE session_id=$1 AND state='ready' GROUP BY plugin_id", [sessionId]);
  const adm = await q<{ plugin_id: string; served: number; answered: number; recent: number | null }>(
    `SELECT plugin_id, count(*)::int AS served, count(*) FILTER (WHERE state='answered')::int AS answered,
            avg(coalesce((score->>'u')::float, CASE WHEN (score->>'z')::float > 0 THEN 1 ELSE 0 END)) FILTER (WHERE state='answered') AS recent
     FROM administrations WHERE session_id=$1 GROUP BY plugin_id`, [sessionId]);
  const ab = await q<{ dimension: string; theta: number; se: number; method: string }>('SELECT dimension, theta, se, method FROM ability_estimates WHERE session_id=$1', [sessionId]);
  const c = await sessionModalityCounts(sessionId);
  return {
    session_id: sessionId,
    phase: s.phase,
    domains: s.engine_state.domains.map((d) => {
      const p = registry().plugins.get(d)!;
      const dim = Object.entries(p.manifest.loading).sort((a, b) => b[1] - a[1])[0]![0];
      const e = ab.find((x) => x.dimension === dim);
      const a = adm.find((x) => x.plugin_id === d);
      return {
        plugin_id: d, ready: buf.find((x) => x.plugin_id === d)?.ready ?? 0, in_flight: inFlightCount(sessionId, d),
        served: a?.served ?? 0, answered: a?.answered ?? 0, theta: e?.theta ?? 0, se: e?.se ?? 1,
        target_se: p.manifest.target_se ?? s.block_plan.global.target_se, max_items: s.block_plan.global.max_per_domain,
        estimated: e?.method === 'eap', recent_accuracy: a?.recent ?? null, unmeasured: !!s.engine_state.unmeasured[d],
      };
    }),
    modality: { text: c.text, visual: c.visual, target_text_share: generationConfig().modality_ratio.text },
  };
}

// ── Serving from the buffer ───────────────────────────────────────────────────────────
export async function readyItems(sessionId: string, pluginId: string, allowed: string[], db?: Db) {
  return q<{ buffer_id: number; item_id: string; task_type: string; modality: Modality; difficulty_b: number; discrimination_a: number; param_source: string; stored: boolean }>(
    `SELECT b.buffer_id, b.item_id, b.task_type, b.modality, i.difficulty_b, i.discrimination_a, i.param_source, b.job_id IS NULL AS stored FROM session_buffer b JOIN items i USING (item_id)
     WHERE b.session_id=$1 AND b.plugin_id=$2 AND b.state='ready' AND b.task_type = ANY($3)
       AND NOT EXISTS (SELECT 1 FROM administrations a WHERE a.session_id=$1 AND a.item_id=b.item_id)
     ORDER BY b.created_at`, [sessionId, pluginId, allowed], db);
}

/**
 * Waits (bounded) for a generation that is already running for this domain. When nothing is running
 * (the earlier attempt failed, or the provider is paused or rate limited) it does not make the user
 * wait for a fresh call: it starts one in the background for the next question and returns at once,
 * so the caller serves a stored question this user has not seen.
 */
export async function awaitBuffered(sessionId: string, locale: string, pluginId: string, allowed: string[], targetB: number, waitMs: number): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  if (providerDegraded()) return false;
  if (!inFlightCount(sessionId, pluginId)) {
    void generateForSession(sessionId, locale, { plugin_id: pluginId, count: 1, target_b: clamp(targetB), reason: 'buffer empty at serve time' });
    return false;
  }
  while (Date.now() < deadline) {
    if ((await readyItems(sessionId, pluginId, allowed)).length) return true;
    const set = inFlight.get(key(sessionId, pluginId));
    if (!set?.size) return (await readyItems(sessionId, pluginId, allowed)).length > 0;
    await Promise.race([Promise.race([...set]), new Promise((r) => setTimeout(r, Math.min(400, Math.max(0, deadline - Date.now()))))]);
  }
  return (await readyItems(sessionId, pluginId, allowed)).length > 0;
}

export async function discardBuffer(sessionId: string, db?: Db) {
  await q("UPDATE session_buffer SET state='discarded' WHERE session_id=$1 AND state='ready'", [sessionId], db);
}

/**
 * Preparation status for the start screen: per domain, questions ready in this session's buffer and
 * generations still running. `settled` once every domain has its initial questions or nothing is left
 * running for it (failed slots fall back to stored questions at serve time).
 */
export async function bufferStatus(sessionId: string, domains: string[]) {
  const cfg = generationConfig();
  const rows = await q<{ plugin_id: string; ready: number }>("SELECT plugin_id, count(*)::int AS ready FROM session_buffer WHERE session_id=$1 AND state='ready' GROUP BY plugin_id", [sessionId]);
  const per = domains.map((d) => ({ plugin_id: d, ready: rows.find((r) => r.plugin_id === d)?.ready ?? 0, generating: inFlightCount(sessionId, d) }));
  const target = cfg.initial_per_domain;
  return {
    target_per_domain: target,
    domains: per,
    ready_total: per.reduce((a, d) => a + Math.min(d.ready, target), 0),
    target_total: target * per.length,
    settled: providerDegraded() || per.every((d) => d.ready >= target || d.generating === 0),
    provider_paused: providerDegraded(),
  };
}
