// Builds L3 exemplar files (plugins/<id>/exemplars/<task_type>/<band>.json) by running each
// plugin's procedural author at the band anchor and keeping items that pass the independent
// solver and the context-blind check. These are solver-verified but NOT human-reviewed: they are
// marked as such, and Doc 03 §8 step 5 (hand-written gold items) still applies before production.
import fs from 'node:fs';
import path from 'node:path';
import { createRng, fairTree, modalityOf, type MatrixCell, type MatrixPuzzle, type MatrixRule, type RawItem } from '@cognimetric/core';
import { config } from '../src/config';
import { loadPlugin } from '../src/plugins/registry';
import { resolveLevers } from '../src/engine/levers';
import { servicesFor } from '../src/services/lexicon';

const BANDS = { easy: -1.5, medium: 0, hard: 1.5 } as const;
const only = process.argv[2];

for (const d of fs.readdirSync(config.PLUGINS_DIR).sort()) {
  if (only && d !== only) continue;
  const dir = path.join(config.PLUGINS_DIR, d);
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) continue;
  const p = await loadPlugin(dir, { requireExemplars: false });
  const m = p.manifest;
  const services = servicesFor(m.bank.locales[0]!, m.requires_services);
  for (const [id, tt] of p.taskTypes) {
    if (tt.def.protocol === 'cross_session' || !tt.author) continue;
    for (const [band, theta] of Object.entries(BANDS)) {
      const rng = createRng(1234 + theta * 10);
      const levers = resolveLevers(m, tt.def, theta, rng);
      const keep: RawItem[] = [];
      for (let attempt = 0; attempt < 30 && keep.length < 2; attempt++) {
        // One exemplar per modality where a task type supports both, so the model sees each format.
        const modality = tt.def.modalities[keep.length % tt.def.modalities.length]!;
        const [item] = tt.author({ taskType: tt.def, modality, levers, count: 1, seed: 9000 + attempt * 7 + Math.round(theta * 100), locale: m.bank.locales[0]!, readingLevel: m.prompt.reading_level, exclusionSignatures: [] }, services);
        if (!item || item.lever_conflict) continue;
        let it = item;
        if (tt.def.distractor_policy === 'fair_tree') {
          const bp = it.blueprint as unknown as { puzzle: MatrixPuzzle; rule: MatrixRule; options: { items: MatrixCell[] } };
          const key = bp.options.items[(it.answer_key as { value: number }).value]!;
          const ft = fairTree(bp.puzzle, bp.rule, key, Number(levers.option_count ?? 5), createRng(attempt + 1));
          if (!ft) continue;
          it = { ...it, blueprint: { ...it.blueprint, options: { count: ft.options.length, generation_policy: 'fair_tree', items: ft.options } }, answer_key: { kind: 'index', value: ft.keyIndex } };
        }
        const v = tt.solver?.({ item: it, levers, services, manifest: m, taskType: tt.def });
        if (v && v.verdict !== 'key_confirmed') continue;
        if (modalityOf(tt.def, it.blueprint as never) !== modality) continue;
        if (tt.contextBlind) {
          const cb = tt.contextBlind({ item: it, levers, services, manifest: m, taskType: tt.def });
          const leak = cb.per_question.some((dist, i) => (dist[cb.key_indices[i]!] ?? 0) > 1 / dist.length + 0.08);
          if (leak) continue;
        }
        const { lever_conflict: _lc, ...rest } = it;
        keep.push({ ...rest, lever_conflict: null });
      }
      const out = path.join(dir, 'exemplars', id, `${band}.json`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify({
        task_type: id, band, theta_anchor: theta,
        review: { status: 'generated_unreviewed', note: 'Procedurally generated and solver-verified. Replace or sign off by a domain reviewer before production (Doc 03 §8 step 5).' },
        levers, items: keep,
      }, null, 2) + '\n');
      console.log(`${m.plugin_id}/${id}/${band}: ${keep.length} exemplar(s)`);
    }
  }
}
