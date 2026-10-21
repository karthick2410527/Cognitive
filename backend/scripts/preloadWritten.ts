// Preloads the bank with written questions from the free-form item-writer prompt, so sessions find
// them ready. For every domain whose written questions come from that prompt, and for each difficulty
// level (easy / medium / hard), it writes questions until the level holds --per-level of them. Every
// question still has its key confirmed by the independent check and passes the usual gates.
// Usage: npm run preload:written [-- --per-level 15 --domain language --batch 5 --max-calls 120]
import { boot } from '../src/index';
import { pool, q1 } from '../src/db/pool';
import { generateNow } from '../src/generation/service';
import { providerDegraded, getProvider } from '../src/llm';
import { usesFreeform } from '../src/live/live';
import { registry } from '../src/plugins/registry';

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const PER_LEVEL = Number(arg('per-level') ?? 15);
const BATCH = Number(arg('batch') ?? 5);
const MAX_CALLS = Number(arg('max-calls') ?? 120); // each batch costs 2 calls (write + check)
const ONLY = arg('domain');
const LEVELS = [['easy', -1.5], ['medium', 0], ['hard', 1.5]] as const;

await boot('preload');
if (getProvider().id === 'local') console.log('note: LLM_PROVIDER is local — questions come from the procedural stand-in, not Gemini');
let calls = 0;
const summary: string[] = [];
outer: for (const p of registry().plugins.values()) {
  const pid = p.manifest.plugin_id;
  if ((ONLY && pid !== ONLY) || !usesFreeform(pid)) continue;
  const tt = p.manifest.task_types.find((t) => t.generation === 'freeform')!;
  for (const locale of ['en']) for (const [label, b] of LEVELS) {
    const have = async () => (await q1<{ n: number }>(
      "SELECT count(*)::int AS n FROM items WHERE plugin_id=$1 AND task_type=$2 AND locale=$3 AND status IN ('live','validated') AND abs(difficulty_b - $4) <= 0.75",
      [pid, tt.id, locale, b]))!.n;
    let n = await have();
    let tries = 0;
    while (n < PER_LEVEL && tries < Math.ceil(PER_LEVEL / BATCH) * 2) {
      if (providerDegraded()) { console.log('provider paused (quota used up) — stopping'); break outer; }
      if (calls + 2 > MAX_CALLS) { console.log(`reached --max-calls ${MAX_CALLS} — stopping`); break outer; }
      tries++;
      calls += 2;
      const r = await generateNow({ kind: 'reseed', pluginId: pid, taskType: tt.id, locale, targetB: b, requested: Math.min(BATCH, PER_LEVEL - n), modality: 'text' }).catch((e) => { console.log(`  ${pid}/${label}: ${(e as Error).message}`); return null; });
      n = await have();
      if (r) console.log(`  ${pid.padEnd(18)} ${label.padEnd(6)} +${r.accepted} accepted, ${r.rejected} rejected ${Object.keys(r.reasons).length ? JSON.stringify(r.reasons) : ''} → ${n}/${PER_LEVEL}`);
    }
    summary.push(`${pid.padEnd(18)} ${label.padEnd(6)} ${n} stored`);
  }
}
console.log(`\nwritten questions in the bank (${calls} provider calls used):`);
for (const s of summary) console.log(`  ${s}`);
await pool.end();
