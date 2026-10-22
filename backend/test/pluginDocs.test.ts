// Each plugin ships a short design doc (plugins/<id>/doc.md, the format of the Memory Plugin doc).
// The code follows the doc: every task type the doc lists exists, every task type in the manifest
// is listed, every lever named in the Easy → Hard table is a real lever, and the rules the memory
// doc states (forced choice, never yes/no; image, word, audio, story types) hold in the code.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRng, type RawItem } from '@cognimetric/core';
import { resolveLevers } from '../src/engine/levers';
import { loadPlugin } from '../src/plugins/registry';
import { ROOT } from '../src/config';
import { servicesFor } from '../src/services/lexicon';

const PLUGINS = fs.readdirSync(path.join(ROOT, 'plugins')).filter((d) => fs.existsSync(path.join(ROOT, 'plugins', d, 'manifest.json')));

const section = (md: string, heading: string) => {
  const m = md.split(/^## /m).find((s) => s.startsWith(heading));
  return m ?? '';
};
const ticks = (s: string) => [...s.matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1]!);

describe('plugin docs follow the code', async () => {
  for (const id of PLUGINS) {
    const dir = path.join(ROOT, 'plugins', id);
    const p = await loadPlugin(dir);
    const md = fs.readFileSync(path.join(dir, 'doc.md'), 'utf8');

    it(`${id}: doc lists exactly the manifest's task types`, () => {
      expect(md.split('\n')[0]).toMatch(/^# .+ Plugin$/);
      expect(new Set(ticks(section(md, 'Types')))).toEqual(new Set(p.manifest.task_types.map((t) => t.id)));
    });

    it(`${id}: every lever in the Easy → Hard table is a lever of the plugin`, () => {
      const levers = ticks(section(md, 'Easy → Hard'));
      expect(levers.length).toBeGreaterThan(3);
      for (const l of levers) expect(Object.keys(p.manifest.difficulty_levers), l).toContain(l);
    });

    it(`${id}: doc has the how-we-ask rules and references`, () => {
      expect(section(md, 'How we ask questions')).toMatch(/\[We do not do this\]/);
      expect(section(md, 'Reference').trim().split('\n').filter((l) => l.startsWith('- ')).length).toBeGreaterThan(1);
    });
  }
});

describe('memory doc: types and rules realised in code', async () => {
  const p = await loadPlugin(path.join(ROOT, 'plugins', 'memory'));
  const services = servicesFor('en', p.manifest.requires_services);

  for (const tid of ['story_recognition_forced_choice', 'audio_recognition_forced_choice']) {
    it(`${tid}: forced choice at every anchor, easy has fewer choices than hard, solver confirms the key and catches a wrong one`, () => {
      const tt = p.taskTypes.get(tid)!;
      expect(tt.def.protocol).toBe('encode_delay_retrieve');
      const counts: number[] = [];
      for (const theta of [-1.5, 0, 1.5]) {
        const levers = resolveLevers(p.manifest, tt.def, theta, createRng(3));
        counts.push(Number(levers.option_count));
        const items = tt.author!({ taskType: tt.def, modality: tt.def.modalities[0]!, levers, count: 8, seed: 40 + theta * 10, locale: 'en', readingLevel: 'grade_5', exclusionSignatures: [] }, services);
        const ok = items.filter((it) => !it.lever_conflict);
        expect(ok.length, `${tid} θ=${theta}`).toBeGreaterThan(5);
        for (const it of ok) {
          const v = tt.solver!({ item: it, levers, services, manifest: p.manifest, taskType: tt.def });
          expect(v.verdict, `${tid} θ=${theta}: ${v.detail ?? ''}`).toBe('key_confirmed');
          const probes = (it.blueprint.phases as { phase: string; probes?: { options: string[] }[] }[]).find((x) => x.phase === 'retrieve')!.probes!;
          for (const pr of probes) {
            expect(pr.options.length).toBeGreaterThan(1);
            expect(pr.options.map((o) => o.toLowerCase())).not.toEqual(expect.arrayContaining(['yes', 'no']));
          }
          const key = (it.answer_key as { value: number[] }).value;
          const wrong: RawItem = { ...it, answer_key: { kind: 'index_per_probe', value: key.map((k, i) => (k + 1) % probes[i]!.options.length) } };
          expect(tt.solver!({ item: wrong, levers, services, manifest: p.manifest, taskType: tt.def }).verdict).toBe('key_mismatch');
        }
      }
      expect(counts[0]).toBeLessThan(counts[2]!);
    });
  }

  it('story: the key is read from the story text, so a story that names the detail twice is rejected', () => {
    const tt = p.taskTypes.get('story_recognition_forced_choice')!;
    const levers = resolveLevers(p.manifest, tt.def, 0, createRng(3));
    const [it] = tt.author!({ taskType: tt.def, modality: 'text', levers, count: 1, seed: 5, locale: 'en', readingLevel: 'grade_5', exclusionSignatures: [] }, services);
    const bp = structuredClone(it!.blueprint) as { phases: { phase: string; stimuli?: { sentence: string; about: string }[] }[] };
    const enc = bp.phases.find((x) => x.phase === 'encode')!;
    const probes = (bp.phases.find((x) => x.phase === 'retrieve') as unknown as { probes: { about: string }[] }).probes;
    enc.stimuli!.push({ sentence: `They also mentioned the ${probes[0]!.about} again.`, about: 'again' });
    const v = tt.solver!({ item: { ...it!, blueprint: bp as never }, levers: { ...levers, set_size: enc.stimuli!.length }, services, manifest: p.manifest, taskType: tt.def });
    expect(v.verdict).toBe('multiple_solutions');
  });

  it('Yes/No recognition is rejected by the memory validator', async () => {
    const tt = p.taskTypes.get('word_recognition_forced_choice')!;
    const levers = resolveLevers(p.manifest, tt.def, 0, createRng(3));
    const [it] = tt.author!({ taskType: tt.def, modality: 'text', levers, count: 1, seed: 5, locale: 'en', readingLevel: 'grade_5', exclusionSignatures: [] }, services);
    const bp = structuredClone(it!.blueprint) as { phases: { phase: string; probes?: { options: string[] }[] }[] };
    bp.phases.find((x) => x.phase === 'retrieve')!.probes![0]!.options = ['Yes', 'No'];
    const issues = tt.validators.flatMap((v) => v({ item: { ...it!, blueprint: bp as never }, levers, services, manifest: p.manifest, taskType: tt.def }));
    expect(issues.map((i) => i.code)).toContain('yes_no_recognition');
  });
});
