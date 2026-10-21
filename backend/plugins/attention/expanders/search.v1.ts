// Visual-search expansion: interleaved set sizes, 50 % target-present, ≤ 3 same responses in a row.
import { balancedSequence, scaled, type ExpanderFn, type ShapeSpec, type TrialSpec } from '@cognimetric/core';
import { num } from './common';

type Rule = { grid: [number, number]; target: ShapeSpec; distractor_pool: ShapeSpec[]; target_present_rate: number };

function build(rng: import('@cognimetric/core').Rng, rule: Rule, n: number, sizes: number[]): TrialSpec[] {
  const [cols, rows] = rule.grid;
  const present = balancedSequence(rng, [true, false], n, 3);
  const setSize = balancedSequence(rng, sizes, n, 3);
  return present.map((p, i) => {
    const size = Math.min(setSize[i]!, cols * rows);
    const cells: (ShapeSpec | null)[] = new Array(cols * rows).fill(null);
    const slots = rng.sample(Array.from({ length: cols * rows }, (_, k) => k), size);
    slots.forEach((s, j) => {
      cells[s] = p && j === 0 ? rule.target : rule.distractor_pool[Math.floor(rng.next() * rule.distractor_pool.length)]!;
    });
    return {
      index: i,
      stimulus: { kind: 'grid', cols, rows, cells },
      foreperiod_ms: 600,
      stimulus_duration_ms: null,
      response_window_ms: 6000,
      correct: p ? 'present' : 'absent',
      condition: `${p ? 'present' : 'absent'}_${size}`,
      meta: { set_size: size, present: p },
    } satisfies TrialSpec;
  });
}

const expand: ExpanderFn = ({ item, levers, rng, timeScale }) => {
  const phases = item.blueprint.phases;
  const rule = phases.find((p) => p.phase === 'trials')!.trial_rule as unknown as Rule;
  const sizes = String(levers.set_sizes ?? '12,24').split(',').map(Number);
  return {
    task_type: item.task_type,
    instruction_text: phases.find((p) => p.phase === 'instructions')?.instruction_text ?? '',
    rule_reminder: String((item.blueprint as Record<string, unknown>).rule_reminder ?? ''),
    responses: [{ id: 'absent', label: 'Absent (F)', key: 'f' }, { id: 'present', label: 'Present (J)', key: 'j' }],
    persistent: { kind: 'shape', spec: rule.target },
    persistent_position: 'top',
    mode: 'self_paced',
    duration_s: null,
    practice: build(rng.fork('practice'), rule, scaled(num(levers.practice_trials, 8), 1, 6), [sizes[0]!]),
    trials: build(rng.fork('trials'), rule, scaled(num(levers.trials, 30), timeScale, 24), sizes),
    practice_pass_accuracy: 0.75,
    nudge: null,
    feedback_in_practice: true,
    time_scale: timeScale,
  };
};

export default expand;
