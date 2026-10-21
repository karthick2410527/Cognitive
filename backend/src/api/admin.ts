// Admin / authoring endpoints (Doc 01 §8): bank health, review queue, manual generation, prompt
// version control. Every mutation is written to audit_log.
import express from 'express';
import { z } from 'zod';
import { LOCALES } from '@cognimetric/core';
import { audit, q, q1, tx } from '../db/pool';
import { coverageBands } from '../engine/levers';
import { enqueueJob, spendToday } from '../generation/service';
import { getProvider, providerDegraded } from '../llm';
import { registry } from '../plugins/registry';
import { HttpError } from '../util';
import { config } from '../config';
import { rateLimit, send, wrap } from './http';

export function adminRouter() {
  const r = express.Router();

  r.get('/bank/health', wrap(async () => {
    const reg = registry();
    const counts = await q<{ plugin_id: string; task_type: string; locale: string; b_band: number; status: string; n: number; fresh: number }>(
      `SELECT i.plugin_id, i.task_type, i.locale, i.b_band, i.status, count(*)::int AS n, count(*) FILTER (WHERE coalesce(s.n_administered,0) < 50)::int AS fresh
       FROM items i LEFT JOIN item_stats s USING (item_id) GROUP BY 1,2,3,4,5`);
    const demand = await q<{ plugin_id: string; task_type: string; n: number }>("SELECT plugin_id, task_type, count(*)::int AS n FROM administrations WHERE served_at > now() - interval '7 days' GROUP BY 1,2");
    const cells: unknown[] = [];
    for (const p of reg.plugins.values()) {
      const m = p.manifest;
      for (const t of m.task_types) {
        if (t.protocol === 'cross_session') continue;
        for (const locale of m.bank.locales) for (const band of coverageBands(m, t)) {
          const rows = counts.filter((c) => c.plugin_id === m.plugin_id && c.task_type === t.id && c.locale === locale && Math.abs(c.b_band - band) < 1e-6);
          const live = rows.find((x) => x.status === 'live')?.n ?? 0;
          const fresh = rows.find((x) => x.status === 'live')?.fresh ?? 0;
          const deficit = Math.max(0, m.bank.k_min_per_cell - live) + Math.max(0, m.bank.k_fresh_per_cell - fresh);
          cells.push({ plugin_id: m.plugin_id, task_type: t.id, locale, b_band: band, live, fresh, validated: rows.find((x) => x.status === 'validated')?.n ?? 0, quarantined: rows.find((x) => x.status === 'quarantined')?.n ?? 0, k_min: m.bank.k_min_per_cell, deficit, alarm: live < 0.5 * m.bank.k_min_per_cell, demand_7d: demand.find((d) => d.plugin_id === m.plugin_id && d.task_type === t.id)?.n ?? 0 });
        }
      }
    }
    const tiers = await q<{ tier: string; n: number }>("SELECT tier, count(*)::int AS n FROM administrations WHERE served_at > now() - interval '24 hours' GROUP BY tier");
    const subst = await q1<{ p95: number | null }>("SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY substitution_distance) AS p95 FROM administrations WHERE served_at > now() - interval '24 hours'");
    const gen = await q<{ plugin_id: string; jobs: number; accepted: number; rejected: number; cost: number; p50: number; p95: number }>(
      `SELECT plugin_id, count(*)::int AS jobs, sum(accepted)::int AS accepted, sum(rejected)::int AS rejected, coalesce(sum(cost_usd),0)::float AS cost,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50, percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95
       FROM generation_jobs WHERE created_at > now() - interval '7 days' AND state='done' GROUP BY plugin_id`);
    const gates = await q<{ gate: string; plugin_id: string; n: number }>("SELECT gate, plugin_id, count(*)::int AS n FROM item_rejections WHERE at > now() - interval '7 days' GROUP BY 1,2");
    const statusCounts = await q<{ status: string; n: number }>('SELECT status, count(*)::int AS n FROM items GROUP BY status');
    const provider = await q('SELECT * FROM provider_status');
    const breakers = await q('SELECT * FROM cell_breakers WHERE tripped_at IS NOT NULL');
    const se = await q<{ dimension: string; median: number }>("SELECT dimension, percentile_cont(0.5) WITHIN GROUP (ORDER BY se) AS median FROM ability_estimates a JOIN sessions s USING (session_id) WHERE s.phase='done' AND a.method='eap' GROUP BY dimension");
    const p = getProvider();
    return {
      cells, status_counts: statusCounts, tiers, substitution_p95: subst?.p95 ?? null, generation: gen, rejects_by_gate: gates,
      provider: { id: p.id, model: p.model, degraded: providerDegraded(), rows: provider }, breakers, spend_today_usd: await spendToday(), daily_cap_usd: config.DAILY_SPEND_CAP_USD,
      se_at_stop: se,
    };
  }));

  r.get('/items', wrap(async (req) => {
    const status = String(req.query.status ?? 'validated');
    const limit = Math.min(100, Number(req.query.limit ?? 30));
    const params: unknown[] = [status, limit];
    let where = 'i.status = $1';
    if (req.query.plugin_id) { params.push(String(req.query.plugin_id)); where += ` AND i.plugin_id = $${params.length}`; }
    if (req.query.task_type) { params.push(String(req.query.task_type)); where += ` AND i.task_type = $${params.length}`; }
    const items = await q(
      `SELECT i.item_id, i.plugin_id, i.task_type, i.protocol, i.locale, i.status, i.levers, i.answer_key, i.rationale, i.text_alternative, i.review, i.verification, i.created_at,
              i.blueprint, i.provenance->'generator'->>'prompt_version' AS prompt_version, r.payload AS rendering, r.target AS render_target,
              (SELECT json_agg(json_build_object('gate', v.gate, 'verdict', v.verdict, 'detail', v.detail)) FROM item_validations v WHERE v.item_id = i.item_id) AS validations
       FROM items i LEFT JOIN item_renderings r ON r.item_id = i.item_id AND r.variant = 'default'
       WHERE ${where} ORDER BY i.created_at DESC LIMIT $2`, params);
    // Reviewers see items without being told the band (Doc 10 §2.1): difficulty fields are withheld.
    return { items: items.map((x) => ({ ...x, rendering: x.rendering ? JSON.parse(String(x.rendering)) : null })) };
  }));

  const Rubric = z.object({
    rubric: z.object({ construct: z.boolean(), key: z.boolean(), leakage: z.boolean(), levers: z.boolean(), fairness: z.boolean(), dignity: z.boolean() }),
    notes: z.string().max(1000).default(''),
    reviewer: z.string().min(1).max(80),
    reviewer_difficulty: z.number().min(-3).max(3).nullable().default(null),
  }).strict();

  r.post('/items/:id/promote', wrap(async (req) => {
    const body = Rubric.safeParse(req.body);
    if (!body.success) throw new HttpError(400, 'invalid_review', 'review rubric required', body.error.issues);
    const { rubric, notes, reviewer, reviewer_difficulty } = body.data;
    const pass = Object.values(rubric).every(Boolean);
    return tx(async (c) => {
      const item = await q1<{ status: string }>('SELECT status FROM items WHERE item_id=$1 FOR UPDATE', [req.params.id], c);
      if (!item) throw new HttpError(404, 'item_not_found', 'unknown item');
      if (!['validated', 'quarantined'].includes(item.status)) throw new HttpError(409, 'not_reviewable', `item is ${item.status}`);
      const review = { by: `human:${reviewer}`, at: new Date().toISOString(), notes, rubric, reviewer_difficulty };
      if (!pass) {
        await q("UPDATE items SET status='retired', review=$2 WHERE item_id=$1", [req.params.id, review], c);
        await audit(reviewer, 'item_rejected_in_review', 'item', req.params.id!, review, c);
        return { item_id: req.params.id, status: 'retired' };
      }
      // A human review record turns solver 'warn' (no independent solver) and bias 'warn' into pass.
      await q("UPDATE item_validations SET verdict='pass', detail = coalesce(detail,'{}'::jsonb) || $2 WHERE item_id=$1 AND verdict='warn'", [req.params.id, JSON.stringify({ human_review: review })], c);
      await q("UPDATE items SET status='live', review=$2 WHERE item_id=$1", [req.params.id, review], c);
      await audit(reviewer, 'item_promoted', 'item', req.params.id!, review, c);
      return { item_id: req.params.id, status: 'live' };
    });
  }));

  r.post('/items/:id/retire', wrap(async (req) => {
    await q("UPDATE items SET status='retired' WHERE item_id=$1", [req.params.id]);
    await audit('admin', 'item_retired', 'item', req.params.id!, req.body ?? null);
    return { item_id: req.params.id, status: 'retired' };
  }));

  const Gen = z.object({
    plugin_id: z.string(), task_type: z.string(), locale: z.enum(LOCALES).default('en'), target_b: z.number().min(-3).max(3), count: z.number().int().min(1).max(16).default(8),
    kind: z.enum(['reseed', 'bank_topup', 'shadow']).default('reseed'),
  }).strict();
  r.post('/generate', rateLimit(10, 60_000, () => 'admin-generate'), wrap(async (req, res) => {
    const body = Gen.safeParse(req.body);
    if (!body.success) throw new HttpError(400, 'invalid_request', 'bad generation request', body.error.issues);
    const tt = registry().taskTypes.get(body.data.task_type);
    if (!tt || tt.plugin.manifest.plugin_id !== body.data.plugin_id) throw new HttpError(400, 'unknown_task_type', 'task type does not belong to plugin');
    const id = await enqueueJob({ kind: body.data.kind, pluginId: body.data.plugin_id, taskType: body.data.task_type, locale: body.data.locale, targetB: body.data.target_b, requested: body.data.count });
    await audit('admin', 'generation_requested', 'job', id, body.data);
    send(res, { job_id: id, queued: !!id, note: id ? 'W1 will pick this up' : 'a job for this cell is already queued' }, 202);
  }));

  r.get('/jobs', wrap(async (req) => ({ jobs: await q('SELECT * FROM generation_jobs ORDER BY created_at DESC LIMIT $1', [Math.min(200, Number(req.query.limit ?? 50))]) })));
  r.get('/rejections', wrap(async (req) => ({
    histogram: await q(
      `SELECT gate, reason_code, plugin_id, task_type, prompt_version, count(*)::int AS n FROM item_rejections
       WHERE at > now() - make_interval(days => $1) GROUP BY 1,2,3,4,5 ORDER BY n DESC LIMIT 200`, [Math.min(90, Number(req.query.days ?? 7))]),
    recent: await q('SELECT id, plugin_id, task_type, gate, reason_code, detail, at FROM item_rejections ORDER BY id DESC LIMIT 25'),
  })));
  r.get('/prompts', wrap(async () => ({ prompts: await q('SELECT prompt_version, layer, plugin_id, body, body_hash, activated_at, retired_at, notes FROM prompt_versions ORDER BY layer, plugin_id, activated_at DESC NULLS LAST') })));
  r.post('/prompts/:v/activate', wrap(async (req) => tx(async (c) => {
    const row = await q1<{ layer: string; plugin_id: string | null }>('SELECT layer, plugin_id FROM prompt_versions WHERE prompt_version=$1', [req.params.v], c);
    if (!row) throw new HttpError(404, 'unknown_prompt', 'unknown prompt version');
    if (row.layer === 'L3') throw new HttpError(400, 'not_activatable', 'L3 exemplars are selected by band, not activated');
    await q('UPDATE prompt_versions SET retired_at=now() WHERE layer=$1 AND plugin_id IS NOT DISTINCT FROM $2 AND retired_at IS NULL AND prompt_version <> $3', [row.layer, row.plugin_id, req.params.v], c);
    await q('UPDATE prompt_versions SET activated_at=now(), retired_at=NULL WHERE prompt_version=$1', [req.params.v], c);
    await audit('admin', 'prompt_activated', 'prompt_version', req.params.v!, { note: 'probation (auto_promote off) applies to the next items' }, c);
    return { activated: req.params.v };
  })));
  r.post('/plugins/:id/:action(enable|disable)', wrap(async (req) => {
    await q('UPDATE plugins SET enabled=$2 WHERE plugin_id=$1', [req.params.id, req.params.action === 'enable']);
    await audit('admin', `plugin_${req.params.action}d`, 'plugin', req.params.id!, null);
    return { plugin_id: req.params.id, enabled: req.params.action === 'enable' };
  }));
  r.post('/breakers/reset', wrap(async (req) => {
    await q('UPDATE cell_breakers SET tripped_at=NULL WHERE plugin_id=$1 AND task_type=$2', [req.body?.plugin_id, req.body?.task_type]);
    await audit('admin', 'breaker_reset', 'cell', `${req.body?.plugin_id}/${req.body?.task_type}`, null);
    return { reset: true };
  }));
  r.get('/sessions', wrap(async () => ({ sessions: await q('SELECT session_id, battery_id, phase, session_index, started_at, completed_at, stop_reason, locale FROM sessions ORDER BY started_at DESC LIMIT 50') })));
  r.get('/plugins', wrap(async () => ({ plugins: await q('SELECT plugin_id, name, version, enabled, loaded_at, dimensions FROM plugins ORDER BY plugin_id') })));
  return r;
}
