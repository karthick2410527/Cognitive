import { balancedSequence, scaled, type ExpanderFn, type Rng, type ShapeName, type Stimulus, type TrialSpec } from '@cognimetric/core';

type Rule = { stimulus_type?: 'shapes' | 'digits'; mapping: { shape?: ShapeName; digit?: number; key: string }[] };

const idOf = (m: Rule['mapping'][number]) => (m.digit !== undefined ? String(m.digit) : m.shape!);
const stimOf = (id: string): Stimulus => (/^\d$/.test(id) ? { kind: 'digit', value: Number(id) } : { kind: 'shape', spec: { shape: id as ShapeName, fill: 'solid', size: 'l', rot: 0 } });

function build(rng: Rng, rule: Rule, n: number, isi: number, stim: number): TrialSpec[] {
  const seq = balancedSequence(rng, rule.mapping.map(idOf), n, 3);
  return seq.map((s, i) => ({
    index: i,
    stimulus: stimOf(s),
    foreperiod_ms: i === 0 ? 1000 : Math.round(isi * (0.85 + rng.next() * 0.3)),
    stimulus_duration_ms: stim,
    response_window_ms: 1500,
    correct: s,
    condition: `alt${rule.mapping.length}`,
  }));
}

const expand: ExpanderFn = ({ item, levers, rng, timeScale }) => {
  const rule = item.blueprint.phases.find((p) => p.phase === 'trials')!.trial_rule as unknown as Rule;
  const isi = Number(levers.isi_ms ?? 1500);
  const stim = Number(levers.stimulus_duration_ms ?? 400);
  const duration = Math.max(30, Number(levers.block_duration_s ?? 75) * timeScale);
  return {
    task_type: item.task_type,
    instruction_text: item.blueprint.phases.find((p) => p.phase === 'instructions')?.instruction_text ?? '',
    rule_reminder: String((item.blueprint as Record<string, unknown>).rule_reminder ?? ''),
    responses: rule.mapping.map((m) => ({ id: idOf(m), label: m.key.toUpperCase(), key: m.key, glyph: stimOf(idOf(m)) })),
    persistent: null,
    persistent_position: 'top',
    mode: 'paced',
    duration_s: duration,
    practice: build(rng.fork('practice'), rule, scaled(Number(levers.practice_trials ?? 8), 1, 4), 1800, 700),
    trials: build(rng.fork('trials'), rule, Math.ceil((duration * 1000) / (isi + 600)), isi, stim),
    practice_pass_accuracy: 0.75,
    nudge: null,
    feedback_in_practice: true,
    time_scale: timeScale,
  };
};

export default expand;
