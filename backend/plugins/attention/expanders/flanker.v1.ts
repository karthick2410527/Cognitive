// Flanker expansion: exact congruency proportion, balanced centre directions, bounded runs.
import { balancedSequence, jittered, proportionSequence, scaled, type ExpanderFn, type TrialSpec } from '@cognimetric/core';
import { NO_DEADLINE_MS, nudgeFor, num } from './common';

type Rule = { flankers_per_side: number; positions: string[]; neutral_rate: number };

function build(rng: import('@cognimetric/core').Rng, rule: Rule, n: number, congruent: number, isi: number, jitter: number, deadline: number): TrialSpec[] {
  const neutral = rule.neutral_rate ?? 0;
  const conds = proportionSequence(rng, [{ value: 'congruent', p: congruent * (1 - neutral) }, { value: 'incongruent', p: (1 - congruent) * (1 - neutral) }, { value: 'neutral', p: neutral }].filter((x) => x.p > 0), n, 4);
  const dirs = balancedSequence(rng, ['L', 'R'] as const, n, 3);
  const k = rule.flankers_per_side ?? 2;
  return conds.map((c, i) => {
    const d = dirs[i]!;
    const f = c === 'congruent' ? d : c === 'incongruent' ? (d === 'L' ? 'R' : 'L') : 'N';
    const row = [...new Array(k).fill(f), d, ...new Array(k).fill(f)] as ('L' | 'R' | 'N')[];
    const pos = rule.positions[Math.floor(rng.next() * rule.positions.length)];
    const y = pos === 'above' ? -0.6 : pos === 'below' ? 0.6 : 0;
    const x = pos === 'left' ? -0.35 : pos === 'right' ? 0.35 : 0;
    return {
      index: i,
      stimulus: { kind: 'positioned', x, y, child: { kind: 'arrows', dirs: row } },
      foreperiod_ms: jittered(rng, isi, jitter),
      stimulus_duration_ms: null,
      response_window_ms: Math.min(deadline, 2500),
      correct: d,
      condition: c,
    } satisfies TrialSpec;
  });
}

const expand: ExpanderFn = ({ item, levers, rng, timeScale }) => {
  const phases = item.blueprint.phases;
  const rule = phases.find((p) => p.phase === 'trials')!.trial_rule as unknown as Rule;
  const deadline = num(levers.response_deadline_ms, NO_DEADLINE_MS);
  return {
    task_type: item.task_type,
    instruction_text: phases.find((p) => p.phase === 'instructions')?.instruction_text ?? '',
    rule_reminder: String((item.blueprint as Record<string, unknown>).rule_reminder ?? ''),
    responses: [{ id: 'L', label: '← Left', key: 'ArrowLeft' }, { id: 'R', label: 'Right →', key: 'ArrowRight' }],
    persistent: null,
    persistent_position: 'top',
    mode: 'paced',
    duration_s: null,
    practice: build(rng.fork('practice'), rule, scaled(num(levers.practice_trials, 10), 1, 6), 0.5, 1500, 0, NO_DEADLINE_MS),
    trials: build(rng.fork('trials'), rule, scaled(num(levers.trials, 36), timeScale, 30), num(levers.congruency_ratio, 0.6), num(levers.isi_ms, 1300), num(levers.isi_jitter, 0), deadline),
    practice_pass_accuracy: 0.75,
    nudge: nudgeFor(levers),
    feedback_in_practice: true,
    time_scale: timeScale,
  };
};

export default expand;
