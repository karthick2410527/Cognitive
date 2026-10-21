// Psychometric simulation suite (Doc 05 §9), run against the live bank's parameter distribution.
// It drives the engine's own measurement model and selection functions (EAP, staircase,
// max_information_balanced, Sympson–Hetter, randomesque) with synthetic test-takers of known θ.
// Usage: tsx scripts/simulate.ts [n=2000] [--quick]
import { createRng } from '@cognimetric/core';
import { pool, q } from '../src/db/pool';
import { BATTERIES } from '../src/engine/battery';
import { blockSd, eap, p2pl, staircase, type Observation } from '../src/engine/irt';
import { chooseItem, domainScore, itemInfo } from '../src/engine/selection';
import type { Candidate } from '../src/bank/bank';

const N = Number(process.argv[2] ?? 2000);
type Item = Candidate & { plugin_id: string; protocol: string; diff: boolean };
const rows = await q<Item>(
  `SELECT i.item_id, i.plugin_id, i.task_type, i.protocol, i.difficulty_b, i.discrimination_a, i.param_source, 0 AS n_administered, NULL AS job_kind, i.created_at,
          coalesce((t.spec->'block_norm'->>'difference_score')::boolean, false) AS diff
   FROM items i JOIN task_types t USING (task_type) WHERE i.status='live' AND i.locale='en'`);
const plugins = [...new Set(rows.map((r) => r.plugin_id))].sort();
const weights = Object.fromEntries((await q<{ task_type: string; spec: { weight: number } }>('SELECT task_type, spec FROM task_types')).map((r) => [r.task_type, r.spec.weight]));
const battery = BATTERIES.standard_5domain_v1!;
const g = battery.global;
const exposure = new Map<string, number>();
const rng = createRng(20261020);
const gauss = () => { const u = rng.next() || 1e-9, v = rng.next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

function respond(item: Item, theta: number): Observation {
  if (item.protocol === 'timed_block') {
    const s = blockSd(item.discrimination_a, item.diff);
    return { kind: 'normal', perf: theta + gauss() * s, s, loading: 1 };
  }
  return { kind: 'binary', a: item.discrimination_a, b: item.difficulty_b, u: rng.next() < p2pl(theta, item.discrimination_a, item.difficulty_b) ? 1 : 0, loading: 1 };
}

function estimate(obs: Observation[]): { theta: number; se: number; method: string } {
  if (obs.length < 3) {
    let t = 0;
    for (const o of obs) t = o.kind === 'normal' ? o.perf : staircase(t, o.u >= 0.5, null, null);
    return { theta: t, se: 1, method: 'staircase' };
  }
  const e = eap(obs);
  return { theta: e.theta, se: e.se, method: 'eap' };
}

function runSession(trueTheta: Record<string, number>, forcePattern?: 'all_correct' | 'all_wrong') {
  const obs: Record<string, Observation[]> = Object.fromEntries(plugins.map((p) => [p, []]));
  const seen = new Set<string>();
  const counts: Record<string, Record<string, number>> = Object.fromEntries(plugins.map((p) => [p, {}]));
  let total = 0, prev: string | null = null;
  const take = (p: string, target: number) => {
    const cand = rows.filter((r) => r.plugin_id === p && !seen.has(r.item_id)).sort((a, b) => Math.abs(a.difficulty_b - target) - Math.abs(b.difficulty_b - target)).slice(0, 40);
    if (!cand.length) return false;
    const tot = Math.max(20, exposure.get('__sessions') ?? 0);
    const exp = new Map(cand.map((c) => [c.item_id, (exposure.get(c.item_id) ?? 0) / tot]));
    const pick = chooseItem({ theta: target, cand, exposure: exp, weights, counts: counts[p]!, nDomain: obs[p]!.length, maxPerDomain: g.max_per_domain, rng })?.pick as Item | undefined;
    if (!pick) return false;
    seen.add(pick.item_id);
    exposure.set(pick.item_id, (exposure.get(pick.item_id) ?? 0) + 1);
    counts[p]![pick.task_type] = (counts[p]![pick.task_type] ?? 0) + 1;
    let o = respond(pick, trueTheta[p]!);
    if (forcePattern && o.kind === 'binary') o = { ...o, u: forcePattern === 'all_correct' ? 1 : 0 };
    obs[p]!.push(o);
    total++; prev = p;
    return true;
  };
  // Block 0: two per domain, interleaved, at b = −0.5 / +0.5.
  for (const b of [-0.5, 0.5]) for (const p of plugins) take(p, b);
  // Block 1 adaptive, then Block 2 confirmation, until the stopping rules fire.
  for (const [max, needSe] of [[20, true], [6, true]] as const) {
    for (let k = 0; k < max && total < g.max_items; k++) {
      const est = Object.fromEntries(plugins.map((p) => [p, estimate(obs[p]!)]));
      const nMean = plugins.reduce((s, p) => s + obs[p]!.length, 0) / plugins.length;
      let best: { p: string; s: number } | null = null;
      for (const p of plugins) {
        const e = est[p]!;
        if (obs[p]!.length >= g.max_per_domain || (needSe && e.method === 'eap' && e.se <= g.target_se)) continue;
        const cand = rows.filter((r) => r.plugin_id === p && !seen.has(r.item_id));
        if (!cand.length) continue;
        const bi = Math.max(...cand.slice(0, 200).map((c) => itemInfo(c, e.theta)));
        if (bi < 0.05) continue;
        const s = domainScore(bi, { n: obs[p]!.length, theta: e.theta, se: e.se, target_se: g.target_se, taskTypeCounts: {} }, nMean, prev === p);
        if (!best || s > best.s) best = { p, s };
      }
      if (!best) break;
      take(best.p, est[best.p]!.theta);
    }
  }
  exposure.set('__sessions', (exposure.get('__sessions') ?? 0) + 1);
  return { est: Object.fromEntries(plugins.map((p) => [p, estimate(obs[p]!)])), total };
}

function summarise(label: string, results: { truth: number; est: number; se: number }[], lengths: number[]) {
  const err = results.map((r) => r.est - r.truth);
  const rmse = Math.sqrt(err.reduce((s, e) => s + e * e, 0) / err.length);
  const bias = err.reduce((s, e) => s + e, 0) / err.length;
  const meanSe = results.reduce((s, r) => s + r.se, 0) / results.length;
  const sdErr = Math.sqrt(err.reduce((s, e) => s + (e - bias) ** 2, 0) / err.length);
  const sorted = lengths.slice().sort((a, b) => a - b);
  console.log(`${label.padEnd(26)} RMSE ${rmse.toFixed(3)}  bias ${bias.toFixed(3)}  mean SE ${meanSe.toFixed(3)} vs SD(err) ${sdErr.toFixed(3)}  length median ${sorted[sorted.length >> 1]} p90 ${sorted[Math.floor(sorted.length * 0.9)]}`);
  return { rmse, bias, meanSe, sdErr };
}

console.log(`bank: ${rows.length} live items over ${plugins.join(', ')}; simulating ${N} sessions\n`);
const rec: { truth: number; est: number; se: number }[] = [];
const lens: number[] = [];
for (let i = 0; i < N; i++) {
  const truth = Object.fromEntries(plugins.map((p) => [p, gauss()]));
  const r = runSession(truth);
  lens.push(r.total);
  for (const p of plugins) rec.push({ truth: truth[p]!, est: r.est[p]!.theta, se: r.est[p]!.se });
}
const main = summarise('Recovery θ ~ N(0,1)', rec, lens);
for (const edge of [-2.5, 2.5]) {
  const e: typeof rec = [];
  const l: number[] = [];
  for (let i = 0; i < Math.max(200, N / 10); i++) {
    const truth = Object.fromEntries(plugins.map((p) => [p, edge]));
    const r = runSession(truth);
    l.push(r.total);
    for (const p of plugins) e.push({ truth: edge, est: r.est[p]!.theta, se: r.est[p]!.se });
  }
  summarise(`Edge θ = ${edge}`, e, l);
}
for (const pat of ['all_correct', 'all_wrong'] as const) {
  const r = runSession(Object.fromEntries(plugins.map((p) => [p, 0])), pat);
  const finite = Object.values(r.est).every((x) => Number.isFinite(x.theta) && Number.isFinite(x.se));
  console.log(`${pat.padEnd(26)} finite estimates: ${finite}  e.g. θ=${Object.values(r.est)[0]!.theta.toFixed(2)} SE=${Object.values(r.est)[0]!.se.toFixed(2)}`);
}
const sessions = exposure.get('__sessions')!;
const rates = [...exposure.entries()].filter(([k]) => k !== '__sessions').map(([, v]) => v / sessions).sort((a, b) => b - a);
const totalAdm = rates.reduce((s, v) => s + v, 0);
const top1 = rates.slice(0, Math.max(1, Math.floor(rows.length * 0.01))).reduce((s, v) => s + v, 0) / totalAdm;
console.log(`\nexposure: max conditional rate ${rates[0]!.toFixed(3)}; top 1 % of items carry ${(100 * top1).toFixed(1)} % of administrations`);
console.log(`\nGate (Doc 10 P2): RMSE < 0.35 → ${main.rmse < 0.35 ? 'PASS' : 'FAIL'}; |bias| < 0.05 → ${Math.abs(main.bias) < 0.05 ? 'PASS' : 'FAIL'}; mean SE within 15 % of SD(err) → ${Math.abs(main.meanSe - main.sdErr) / main.sdErr < 0.15 ? 'PASS' : 'FAIL'}`);
await pool.end();
