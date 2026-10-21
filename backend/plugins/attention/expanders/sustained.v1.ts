// Expands a go/no-go stream rule into trials with the administration seed (Doc 04 §11).
import { binarySequence, jittered, scaled, type ExpanderFn, type ShapeName, type Stimulus, type TrialSpec } from '@cognimetric/core';
import { NO_DEADLINE_MS, nudgeFor, num } from './common';

type Rule = { stimulus_set: { type: 'digits' | 'shapes' | 'symbols'; values: (number | string)[]; set?: string }; target: number | string };

const stim = (type: string, v: number | string): Stimulus =>
  type === 'digits' ? { kind: 'digit', value: Number(v) } : type === 'symbols' ? { kind: 'symbol', id: Number(v), set: 'high' } : { kind: 'shape', spec: { shape: v as ShapeName, fill: 'solid', size: 'l', rot: 0 } };

function stream(rng: import('@cognimetric/core').Rng, rule: Rule, n: number, rate: number, stimMs: number, isiMs: number, jitter: number, deadline: number, firstNoTarget: number): TrialSpec[] {
  const targets = binarySequence(rng, { n, rate, maxRun: 2, noTargetFirst: firstNoTarget });
  const others = rule.stimulus_set.values.filter((v) => v !== rule.target);
  const trials: TrialSpec[] = [];
  let carry = 1000;
  let prev: number | string | null = null;
  for (let i = 0; i < n; i++) {
    let v: number | string;
    if (targets[i]) v = rule.target;
    else {
      const choices = others.filter((o) => o !== prev);
      v = choices[Math.floor(rng.next() * choices.length)]!;
    }
    prev = v;
    const span = stimMs + jittered(rng, isiMs, jitter);
    const window = Math.min(deadline, span);
    trials.push({ index: i, stimulus: stim(rule.stimulus_set.type, v), foreperiod_ms: carry, stimulus_duration_ms: stimMs, response_window_ms: window, correct: targets[i] ? null : 'go', condition: targets[i] ? 'target' : 'nontarget' });
    carry = span - window;
  }
  return trials;
}

const expand: ExpanderFn = ({ item, levers, rng, timeScale }) => {
  const phases = item.blueprint.phases;
  const rule = phases.find((p) => p.phase === 'trials')!.trial_rule as unknown as Rule;
  const stimMs = num(levers.stimulus_duration_ms, 300);
  const isi = num(levers.isi_ms, 1300);
  const jitter = num(levers.isi_jitter, 0);
  const deadline = num(levers.response_deadline_ms, NO_DEADLINE_MS);
  const duration = num(levers.block_duration_s, 180) * timeScale;
  const n = Math.max(40, Math.floor((duration * 1000) / (stimMs + isi)));
  return {
    task_type: item.task_type,
    instruction_text: phases.find((p) => p.phase === 'instructions')?.instruction_text ?? '',
    rule_reminder: String((item.blueprint as Record<string, unknown>).rule_reminder ?? ''),
    responses: [{ id: 'go', label: 'Tap', key: ' ' }],
    // Symbol targets cannot be named in words, so the target stays on screen (the rule is never held in memory).
    persistent: rule.stimulus_set.type === 'symbols' ? { kind: 'symbol', id: Number(rule.target), set: rule.stimulus_set.set ?? 'high' } : null,
    persistent_position: 'top',
    mode: 'paced',
    duration_s: null,
    practice: stream(rng.fork('practice'), rule, scaled(num(levers.practice_trials, 12), 1, 6), 0.25, 500, 1500, 0, NO_DEADLINE_MS, 2),
    trials: stream(rng.fork('trials'), rule, n, num(levers.target_rate, 0.14), stimMs, isi, jitter, deadline, 5),
    practice_pass_accuracy: 0.7,
    nudge: nudgeFor(levers),
    feedback_in_practice: true,
    time_scale: timeScale,
  };
};

export default expand;
