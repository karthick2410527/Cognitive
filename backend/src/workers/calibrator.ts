// W3 — calibration (Doc 05 §5, §8.4): item statistics, 2PL refit for items with ≥ 300 responses,
// lever-model regression per cell, drift and item-level flags, weekly context-blind cell sample.
import { createRng } from '@cognimetric/core';
import { audit, q } from '../db/pool';
import { registry } from '../plugins/registry';
import { servicesFor } from '../services/lexicon';
import { log } from '../util';
import { leverScaled } from '../engine/params';

const MIN_N = Number(process.env.CALIBRATION_MIN_RESPONSES ?? 300);

function pointBiserial(u: number[], theta: number[]): number | null {
  const n = u.length;
  if (n < 10) return null;
  const mu = u.reduce((a, b) => a + b, 0) / n;
  const mt = theta.reduce((a, b) => a + b, 0) / n;
  let cov = 0, vu = 0, vt = 0;
  for (let i = 0; i < n; i++) { cov += (u[i]! - mu) * (theta[i]! - mt); vu += (u[i]! - mu) ** 2; vt += (theta[i]! - mt) ** 2; }
  return vu && vt ? cov / Math.sqrt(vu * vt) : null;
}

/** 2PL item refit with person θ fixed at their session estimates (Newton–Raphson on a, b). */
export function fit2pl(u: number[], theta: number[], a0 = 1, b0 = 0): { a: number; b: number } | null {
  let a = a0, b = b0;
  for (let it = 0; it < 50; it++) {
    let ga = 0, gb = 0, haa = 0, hbb = 0, hab = 0;
    for (let i = 0; i < u.length; i++) {
      const p = 1 / (1 + Math.exp(-a * (theta[i]! - b)));
      const r = u[i]! - p;
      const w = p * (1 - p);
      const d = theta[i]! - b;
      ga += r * d; gb += -a * r;
      haa -= w * d * d; hbb -= w * a * a; hab += w * a * d - r;
    }
    const det = haa * hbb - hab * hab;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
    const da = (hbb * ga - hab * gb) / det;
    const db = (haa * gb - hab * ga) / det;
    a -= da; b -= db;
    a = Math.min(4, Math.max(0.2, a)); b = Math.min(4, Math.max(-4, b));
    if (Math.abs(da) + Math.abs(db) < 1e-5) break;
  }
  return { a, b };
}

/** OLS with ridge λ for the lever model: logit(p) ≈ β0 + Σ βk·lever_k − θ. */
function ridge(X: number[][], y: number[], lambda = 1): number[] {
  const k = X[0]!.length;
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const v = new Array(k).fill(0);
  for (let i = 0; i < X.length; i++) for (let r = 0; r < k; r++) { v[r] += X[i]![r]! * y[i]!; for (let c = 0; c < k; c++) A[r]![c] += X[i]![r]! * X[i]![c]!; }
  for (let r = 1; r < k; r++) A[r]![r] += lambda;
  // Gaussian elimination.
  for (let i = 0; i < k; i++) {
    let p = i;
    for (let r = i + 1; r < k; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[p]![i]!)) p = r;
    [A[i], A[p]] = [A[p]!, A[i]!];
    [v[i], v[p]] = [v[p], v[i]];
    const d = A[i]![i]! || 1e-9;
    for (let r = 0; r < k; r++) {
      if (r === i) continue;
      const f = A[r]![i]! / d;
      for (let c = i; c < k; c++) A[r]![c] -= f * A[i]![c]!;
      v[r] -= f * v[i];
    }
  }
  return v.map((x, i) => x / (A[i]![i]! || 1e-9));
}

export async function calibrate() {
  // 1. Item statistics from scored administrations.
  const rows = await q<{ item_id: string; u: number; theta: number; rt: number | null }>(
    `SELECT a.item_id, coalesce((a.score->>'u')::float, CASE WHEN (a.score->>'z')::float > 0 THEN 1 ELSE 0 END) AS u,
            coalesce((e.theta), 0) AS theta, (a.score->>'rt_ms')::float AS rt
     FROM administrations a JOIN items i USING (item_id)
     JOIN LATERAL (SELECT theta FROM ability_estimates x WHERE x.session_id = a.session_id ORDER BY (x.dimension = (SELECT key FROM jsonb_each(i.provenance->'loading') LIMIT 1)) DESC NULLS LAST, n_items DESC LIMIT 1) e ON true
     WHERE a.state='answered'`);
  const byItem = new Map<string, { u: number[]; t: number[]; rt: number[] }>();
  for (const r of rows) {
    const x = byItem.get(r.item_id) ?? { u: [], t: [], rt: [] };
    x.u.push(r.u); x.t.push(r.theta); if (r.rt !== null) x.rt.push(r.rt);
    byItem.set(r.item_id, x);
  }
  let refit = 0, flagged = 0;
  for (const [itemId, x] of byItem) {
    const n = x.u.length;
    const p = x.u.reduce((a, b) => a + b, 0) / n;
    const pb = pointBiserial(x.u, x.t);
    const flags: string[] = [];
    if (n >= 30 && (p < 0.15 || p > 0.95)) flags.push('no_information');
    if (pb !== null && n >= 30 && pb < 0.1) flags.push('low_point_biserial');
    if (pb !== null && n >= 30 && pb < 0) flags.push('negative_point_biserial');
    await q('UPDATE item_stats SET p_value=$2, point_biserial=$3, mean_rt_ms=$4, flags=$5 WHERE item_id=$1', [itemId, p, pb, x.rt.length ? x.rt.reduce((a, b) => a + b, 0) / x.rt.length : null, flags]);
    if (flags.includes('negative_point_biserial')) {
      flagged++;
      await q('UPDATE item_stats SET drift_flag=true WHERE item_id=$1', [itemId]);
      await audit('W3', 'alarm_negative_point_biserial', 'item', itemId, { n, p, pb, note: 'almost always a wrong key that slipped past the solver' });
    }
    if (n >= MIN_N) {
      const f = fit2pl(x.u, x.t);
      if (f) {
        refit++;
        await q("UPDATE items SET discrimination_a=$2, difficulty_b=$3, param_source='calibrated' WHERE item_id=$1", [itemId, f.a, f.b]);
      }
    }
  }
  // 2. Lever model per (plugin, task_type, locale) once a cell family has enough responses.
  const lm = await q<{ plugin_id: string; task_type: string; locale: string; levers: Record<string, unknown>; u: number; theta: number }>(
    `SELECT i.plugin_id, i.task_type, i.locale, i.levers, coalesce((a.score->>'u')::float, 0.5) AS u, (a.theta_at_serve->>i.plugin_id)::float AS theta
     FROM administrations a JOIN items i USING (item_id) WHERE a.state='answered' AND a.score->>'kind'='choice'`);
  const groups = new Map<string, typeof lm>();
  for (const r of lm) groups.set(`${r.plugin_id}|${r.task_type}|${r.locale}`, [...(groups.get(`${r.plugin_id}|${r.task_type}|${r.locale}`) ?? []), r]);
  for (const [key, rs] of groups) {
    if (rs.length < MIN_N) continue;
    const names = Object.keys(leverScaled(rs[0]!.levers as never));
    const X = rs.map((r) => [1, ...names.map((n) => leverScaled(r.levers as never)[n] ?? 0)]);
    const y = rs.map((r) => { const p = Math.min(0.97, Math.max(0.03, r.u)); return Math.log(p / (1 - p)) + (r.theta ?? 0); });
    const beta = ridge(X, y);
    // logit p = θ − b  ⇒  b = −(β0 + Σβx)
    const [pluginId, taskType, locale] = key.split('|');
    await q(`INSERT INTO lever_models (plugin_id, task_type, locale, intercept, coefficients, n_responses) VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (plugin_id, task_type, locale) DO UPDATE SET intercept=$4, coefficients=$5, n_responses=$6, fitted_at=now()`,
      [pluginId, taskType, locale, -beta[0]!, Object.fromEntries(names.map((n, i) => [n, -beta[i + 1]!])), rs.length]);
  }
  // 3. Context-blind cell sample (Doc 04 §6.2): up to 200 live items per task type with a context-blind solver.
  for (const p of registry().plugins.values()) for (const [id, tt] of p.taskTypes) {
    if (!tt.contextBlind) continue;
    const items = await q<{ blueprint: unknown; answer_key: unknown; levers: Record<string, unknown>; locale: string; task_type: string; rationale: string }>("SELECT blueprint, answer_key, levers, locale, task_type, rationale FROM items WHERE task_type=$1 AND status='live' ORDER BY random() LIMIT 200", [id]);
    if (items.length < 20) continue;
    let s = 0, chance = 0;
    for (const it of items) {
      const r = tt.contextBlind({ item: { ...it, lever_realisation: {} } as never, levers: it.levers as never, services: servicesFor(it.locale, p.manifest.requires_services), manifest: p.manifest, taskType: tt.def });
      r.per_question.forEach((d, i) => { s += d[r.key_indices[i]!] ?? 0; chance += 1 / d.length; });
    }
    const nq = items.reduce((a, it) => a + 1, 0);
    if (s / nq > chance / nq + 0.1) await audit('W3', 'alarm_context_blind_cell', 'task_type', id, { score: s / nq, chance: chance / nq, sample: items.length });
  }
  void createRng;
  log('W3', `calibration pass: ${byItem.size} items with data, ${refit} refit (≥ ${MIN_N} responses), ${flagged} flagged`);
}
