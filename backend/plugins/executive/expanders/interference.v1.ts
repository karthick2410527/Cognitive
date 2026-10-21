// Interference expansion: exact congruency proportion, balanced correct sides, bounded runs.
import { balancedSequence, jittered, proportionSequence, scaled, type ExpanderFn, type Rng, type Stimulus, type TrialSpec } from '@cognimetric/core';

type Rule = { kind: 'spatial_stroop'; offset: number } | { kind: 'size_stroop'; min_distance: number; scales: [number, number] };
const num = (v: unknown, d: number) => (typeof v === 'number' ? v : Number(v ?? d));

function build(rng: Rng, rule: Rule, n: number, congruent: number, isi: number, jitter: number, deadline: number): TrialSpec[] {
  const conds = proportionSequence(rng, [{ value: 'congruent', p: congruent }, { value: 'incongruent', p: 1 - congruent }], n, 4);
  const sides = balancedSequence(rng, ['L', 'R'] as const, n, 3);
  return conds.map((c, i) => {
    const correct = sides[i]!;
    let stimulus: Stimulus;
    if (rule.kind === 'spatial_stroop') {
      const side = c === 'congruent' ? correct : correct === 'L' ? 'R' : 'L';
      const offset = (rule as unknown as { offset?: number }).offset ?? 0.5;
      stimulus = { kind: 'positioned', x: (side === 'L' ? -1 : 1) * offset * 1.3, y: 0, child: { kind: 'arrows', dirs: [correct] } };
    } else {
      let a = 0, b = 0;
      const minDistance = (rule as unknown as { min_distance?: number }).min_distance ?? 1;
      while (Math.abs(a - b) < minDistance) { a = 1 + Math.floor(rng.next() * 9); b = 1 + Math.floor(rng.next() * 9); }
      const big = Math.max(a, b), small = Math.min(a, b);
      const rawScales = (rule as unknown as { scales?: [number, number] }).scales;
      const [lo, hi] = Array.isArray(rawScales) && rawScales.length === 2 ? rawScales : [0.8, 1.2];
      const largerPrintOnLarger = c === 'congruent';
      const left = correct === 'L' ? big : small;
      const right = correct === 'L' ? small : big;
      const scaleOf = (v: number) => ((v === big) === largerPrintOnLarger ? hi : lo);
      stimulus = { kind: 'pair', left: { kind: 'digit', value: left, scale: scaleOf(left) }, right: { kind: 'digit', value: right, scale: scaleOf(right) } };
    }
    return { index: i, stimulus, foreperiod_ms: jittered(rng, isi, jitter), stimulus_duration_ms: null, response_window_ms: Math.min(deadline, 2500), correct, condition: c } satisfies TrialSpec;
  });
}

const expand: ExpanderFn = ({ item, levers, rng, timeScale }) => {
  const phases = item.blueprint.phases;
  const rule = phases.find((p) => p.phase === 'trials')!.trial_rule as unknown as Rule;
  const deadline = num(levers.response_deadline_ms, 3000);
  return {
    task_type: item.task_type,
    instruction_text: phases.find((p) => p.phase === 'instructions')?.instruction_text ?? '',
    rule_reminder: String((item.blueprint as Record<string, unknown>).rule_reminder ?? ''),
    responses: [{ id: 'L', label: '← Left', key: 'ArrowLeft' }, { id: 'R', label: 'Right →', key: 'ArrowRight' }],
    persistent: null,
    persistent_position: 'top',
    mode: 'paced',
    duration_s: null,
    practice: build(rng.fork('practice'), rule, scaled(num(levers.practice_trials, 10), 1, 6), 0.5, 1500, 0, 3000),
    trials: build(rng.fork('trials'), rule, scaled(num(levers.trials, 36), timeScale, 30), num(levers.congruency_ratio, 0.6), num(levers.isi_ms, 1300), num(levers.isi_jitter, 0), deadline),
    practice_pass_accuracy: 0.75,
    nudge: deadline < 3000 ? { max_mean_rt_ms: deadline - 100, message: 'Try to respond a little faster.' } : null,
    feedback_in_practice: true,
    time_scale: timeScale,
  };
};

export default expand;
