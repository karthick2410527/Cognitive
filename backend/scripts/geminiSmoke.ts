// One real Gemini generation through the full pipeline (4-layer prompt → model → 5 gates → bank).
// Usage: tsx scripts/geminiSmoke.ts <task_type> [modality] [target_b]
import { boot } from '../src/index';
import { pool } from '../src/db/pool';
import { generateNow } from '../src/generation/service';
import { registry } from '../src/plugins/registry';

await boot('smoke');
const tt = process.argv[2] ?? 'semantic_odd_one_out';
const entry = registry().taskTypes.get(tt)!;
const t0 = Date.now();
const r = await generateNow({ kind: 'reseed', pluginId: entry.plugin.manifest.plugin_id, taskType: tt, locale: 'en', targetB: Number(process.argv[4] ?? 0), requested: 2, modality: (process.argv[3] as 'text' | 'visual' | undefined) });
console.log(JSON.stringify({ task_type: tt, modality: r.modality, accepted: r.accepted, rejected: r.rejected, reasons: r.reasons, cost_usd: r.costUsd, ms: Date.now() - t0 }));
await pool.end();
