// Seeds the development bank through the real pipeline (local provider → 5 gates → render → bank)
// so the app runs end to end with no API key. Usage: npm run seed [-- --k 6 --plugin memory --locale en]
import { boot } from '../src/index';
import { pool } from '../src/db/pool';
import { config } from '../src/config';
import { coverage } from '../src/workers/generator';
import { enqueueJob, runJob } from '../src/generation/service';
import { q1 } from '../src/db/pool';

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const K = Number(arg('k') ?? config.SEED_K);
const onlyPlugin = arg('plugin');
const onlyLocale = arg('locale');

await boot('seed');
const totals: Record<string, { accepted: number; rejected: number; reasons: Record<string, number> }> = {};
for (let round = 0; round < 4; round++) {
  const cells = (await coverage(K)).filter((c) => c.deficit > 0 && (!onlyPlugin || c.plugin_id === onlyPlugin) && (!onlyLocale || c.locale === onlyLocale));
  if (!cells.length) break;
  console.log(`round ${round + 1}: ${cells.length} cells below K=${K}`);
  const queue = [...cells];
  const work = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const need = Math.max(1, K - c.live);
      const id = await enqueueJob({ kind: 'reseed', pluginId: c.plugin_id, taskType: c.task_type, locale: c.locale, targetB: c.b_band, requested: Math.min(16, need + 2) });
      if (!id) continue;
      const job = await q1("UPDATE generation_jobs SET state='running', started_at=now(), attempts=1 WHERE job_id=$1 RETURNING *", [id]);
      const r = await runJob(job as never);
      const t = (totals[`${c.plugin_id}/${c.task_type}`] ??= { accepted: 0, rejected: 0, reasons: {} });
      t.accepted += r.accepted; t.rejected += r.rejected;
      for (const [k, v] of Object.entries(r.reasons)) t.reasons[k] = (t.reasons[k] ?? 0) + v;
    }
  };
  await Promise.all([work(), work(), work(), work()]);
}
console.log('\nseed summary (accepted / rejected, reject reasons):');
for (const [k, t] of Object.entries(totals)) {
  const rate = t.accepted + t.rejected ? Math.round((100 * t.rejected) / (t.accepted + t.rejected)) : 0;
  console.log(`  ${k.padEnd(50)} ${String(t.accepted).padStart(4)} / ${String(t.rejected).padStart(3)}  (${rate}% rejected) ${JSON.stringify(t.reasons)}`);
}
await pool.end();
