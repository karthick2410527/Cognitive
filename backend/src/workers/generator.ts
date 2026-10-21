// W1 — bank top-up as stock-keeping (Doc 01 §6.1): for every (plugin, task_type, locale, b-band)
// keep ≥ K_min live items and ≥ K_fresh with < 50 exposures. priority = deficit × demand.
import { q } from '../db/pool';
import { coverageBands } from '../engine/levers';
import { claimJob, enqueueJob, runJob, type JobKind } from '../generation/service';
import { registry } from '../plugins/registry';
import { log } from '../util';

export interface Cell { plugin_id: string; task_type: string; locale: string; b_band: number; live: number; fresh: number; deficit: number; demand: number; priority: number }

export async function coverage(kMinOverride?: number): Promise<Cell[]> {
  const rows = await q<{ plugin_id: string; task_type: string; locale: string; b_band: number; live: number; fresh: number }>(
    `SELECT i.plugin_id, i.task_type, i.locale, i.b_band, count(*)::int AS live, count(*) FILTER (WHERE coalesce(s.n_administered,0) < 50)::int AS fresh
     FROM items i LEFT JOIN item_stats s USING (item_id) WHERE i.status='live' GROUP BY 1,2,3,4`);
  const demand = await q<{ plugin_id: string; task_type: string; n: number }>("SELECT plugin_id, task_type, count(*)::int AS n FROM administrations WHERE served_at > now() - interval '7 days' GROUP BY 1,2");
  const cells: Cell[] = [];
  for (const p of registry().plugins.values()) {
    const m = p.manifest;
    for (const t of m.task_types) {
      // Free-form questions are written on demand for sessions (and then reused), not stocked here.
      if (t.protocol === 'cross_session' || t.generation === 'freeform') continue;
      for (const locale of m.bank.locales) for (const band of coverageBands(m, t)) {
        const r = rows.find((x) => x.plugin_id === m.plugin_id && x.task_type === t.id && x.locale === locale && Math.abs(x.b_band - band) < 1e-6);
        const kMin = kMinOverride ?? m.bank.k_min_per_cell;
        const kFresh = Math.min(kMin, m.bank.k_fresh_per_cell);
        const deficit = Math.max(0, kMin - (r?.live ?? 0)) + Math.max(0, kFresh - (r?.fresh ?? 0));
        const d = demand.find((x) => x.plugin_id === m.plugin_id && x.task_type === t.id)?.n ?? 0;
        cells.push({ plugin_id: m.plugin_id, task_type: t.id, locale, b_band: band, live: r?.live ?? 0, fresh: r?.fresh ?? 0, deficit, demand: d, priority: deficit * (1 + d) });
      }
    }
  }
  return cells.sort((a, b) => b.priority - a.priority);
}

export async function topUpTick(maxNewJobs = 4) {
  const tripped = await q<{ plugin_id: string; task_type: string; locale: string; b_band: number }>(
    'SELECT plugin_id, task_type, locale, b_band FROM cell_breakers WHERE tripped_at IS NOT NULL',
  );
  const isTripped = (c: Cell) => tripped.some((t) => t.plugin_id === c.plugin_id && t.task_type === c.task_type && t.locale === c.locale && Math.abs(t.b_band - c.b_band) < 1e-6);
  const cells = (await coverage()).filter((c) => c.deficit > 0 && !isTripped(c)).slice(0, maxNewJobs);
  for (const c of cells) {
    const batch = registry().plugins.get(c.plugin_id)!.manifest.bank.batch_size;
    await enqueueJob({ kind: 'bank_topup', pluginId: c.plugin_id, taskType: c.task_type, locale: c.locale, targetB: c.b_band, requested: Math.min(batch, Math.max(2, c.deficit)) });
  }
}

export async function drainJobs(maxJobs = 4, kinds?: JobKind[]) {
  for (let i = 0; i < maxJobs; i++) {
    const job = await claimJob(kinds);
    if (!job) return;
    try {
      const r = await runJob(job as never);
      log('W1', `${job.kind} ${job.plugin_id}/${job.task_type}/${job.locale}/b=${job.b_band}: accepted ${r.accepted} (live ${r.live}), rejected ${r.rejected}`, Object.keys(r.reasons).length ? r.reasons : undefined);
    } catch (e) {
      await q("UPDATE generation_jobs SET state='failed', error=$2, finished_at=now() WHERE job_id=$1", [job.job_id, (e as Error).message]);
      log('W1', `job ${job.job_id} failed: ${(e as Error).message}`);
    }
  }
}
