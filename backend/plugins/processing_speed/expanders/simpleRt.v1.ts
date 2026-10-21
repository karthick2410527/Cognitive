import { scaled, type ExpanderFn, type Rng, type ShapeName, type TrialSpec } from '@cognimetric/core';

function build(rng: Rng, shape: ShapeName, n: number, [lo, hi]: [number, number]): TrialSpec[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    stimulus: { kind: 'shape', spec: { shape, fill: 'solid', size: 'l', rot: 0 } },
    foreperiod_ms: Math.round(lo + rng.next() * (hi - lo)),
    stimulus_duration_ms: null,
    response_window_ms: 2000,
    correct: 'go',
    condition: 'onset',
  }));
}

const expand: ExpanderFn = ({ item, levers, rng, timeScale }) => {
  const rule = item.blueprint.phases.find((p) => p.phase === 'trials')!.trial_rule as { shape: ShapeName; foreperiod_range_ms: [number, number] };
  const duration = Math.max(30, Number(levers.block_duration_s ?? 60) * timeScale);
  return {
    task_type: item.task_type,
    instruction_text: item.blueprint.phases.find((p) => p.phase === 'instructions')?.instruction_text ?? '',
    rule_reminder: String((item.blueprint as Record<string, unknown>).rule_reminder ?? ''),
    responses: [{ id: 'go', label: 'Tap', key: ' ' }],
    persistent: null,
    persistent_position: 'top',
    mode: 'paced',
    duration_s: duration,
    practice: build(rng.fork('practice'), rule.shape, scaled(Number(levers.practice_trials ?? 6), 1, 4), rule.foreperiod_range_ms),
    trials: build(rng.fork('trials'), rule.shape, Math.ceil(duration / 1.5), rule.foreperiod_range_ms),
    practice_pass_accuracy: 0.7,
    nudge: null,
    feedback_in_practice: true,
    time_scale: timeScale,
  };
};

export default expand;
