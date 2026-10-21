// The written question types every domain gained (Doc 03 hooks, product request for 70 % written
// questions): each procedural author's items pass its own independent solver at every difficulty
// anchor, and the solver catches a wrong key and a broken item.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRng, type RawItem } from '@cognimetric/core';
import { resolveLevers } from '../src/engine/levers';
import { loadPlugin, loadRegistry } from '../src/plugins/registry';
import { ROOT, config } from '../src/config';

const TYPES: [string, string][] = [
  ['attention', 'mismatch_pair'], ['attention', 'letter_count'],
  ['executive', 'number_series'], ['executive', 'odd_number_out'],
  ['processing_speed', 'code_match'], ['processing_speed', 'quick_arithmetic'],
];

describe('written question types', async () => {
  const plugins = new Map<string, Awaited<ReturnType<typeof loadPlugin>>>();
  for (const p of new Set(TYPES.map(([p]) => p))) plugins.set(p, await loadPlugin(path.join(ROOT, 'plugins', p)));

  for (const [pid, tid] of TYPES) {
    it(`${pid}/${tid}: authored items are text, solver-confirmed at every anchor, and a wrong key is caught`, () => {
      const p = plugins.get(pid)!;
      const tt = p.taskTypes.get(tid)!;
      expect(tt.def.modalities).toEqual(['text']);
      expect(tt.def.protocol).toBe('single');
      for (const theta of [-1.5, 0, 1.5, 2.5]) {
        const levers = resolveLevers(p.manifest, tt.def, theta, createRng(7));
        const items = tt.author!({ taskType: tt.def, modality: 'text', levers, count: 6, seed: 100 + theta * 10, locale: 'en', readingLevel: 'grade_5', exclusionSignatures: [] }, {});
        const solved = items.filter((it) => !it.lever_conflict);
        expect(solved.length).toBeGreaterThan(3);
        for (const it of solved) {
          const v = tt.solver!({ item: it, levers, services: {}, manifest: p.manifest, taskType: tt.def });
          expect(v.verdict, `${tid} θ=${theta}: ${v.detail ?? ''} ${JSON.stringify(it.blueprint)}`).toBe('key_confirmed');
          const n = (it.blueprint.phases[0]!.options ?? []).length;
          const wrong: RawItem = { ...it, answer_key: { kind: 'index', value: ((it.answer_key as { value: number }).value + 1) % n } };
          expect(tt.solver!({ item: wrong, levers, services: {}, manifest: p.manifest, taskType: tt.def }).verdict).toBe('key_mismatch');
        }
      }
    });
  }

  it('number_series rejects a sequence two rules continue differently', () => {
    const p = plugins.get('executive')!;
    const tt = p.taskTypes.get('number_series')!;
    // 2, 3, 5, 8 continues as a sum of the two before (13) or as a step growing by 1 (12): ambiguous.
    const item = { task_type: 'number_series', blueprint: { phases: [{ phase: 'present', stem: '2, 3, 5, 8, ?', options: ['12', '13', '11', '14'] }] }, answer_key: { kind: 'index', value: 1 }, rationale: '', lever_realisation: {} } as unknown as RawItem;
    expect(tt.solver!({ item, levers: {}, services: {}, manifest: p.manifest, taskType: tt.def }).verdict).toBe('multiple_solutions');
  });

  it('mismatch_pair rejects an item where two rows differ', () => {
    const p = plugins.get('attention')!;
    const tt = p.taskTypes.get('mismatch_pair')!;
    const item = { task_type: 'mismatch_pair', blueprint: { phases: [{ phase: 'present', stem: 'Which pair does not match exactly?', options: ['AB34  —  AB34', 'KM7Q  —  KN7Q', 'ZZ29  —  ZZ28'] }] }, answer_key: { kind: 'index', value: 1 }, rationale: '', lever_realisation: {} } as unknown as RawItem;
    expect(tt.solver!({ item, levers: {}, services: {}, manifest: p.manifest, taskType: tt.def }).verdict).toBe('multiple_solutions');
  });
});

describe('all plugins together', () => {
  it('boot as one registry: task type ids are unique and every domain has a free-form written type', async () => {
    const r = await loadRegistry(config.PLUGINS_DIR);
    for (const p of r.plugins.values()) {
      const ff = p.manifest.task_types.filter((t) => t.generation === 'freeform');
      expect(ff, p.manifest.plugin_id).toHaveLength(1);
      expect(ff[0]!.modalities).toEqual(['text']);
    }
  });
});
