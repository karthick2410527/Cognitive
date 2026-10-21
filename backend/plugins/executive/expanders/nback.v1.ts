// n-back expansion with separate lure classes (n−1 / n+1) so lure false alarms can be scored apart.
import { binarySequence, scaled, type ExpanderFn, type Rng, type ShapeName, type Stimulus, type TrialSpec } from '@cognimetric/core';

type Rule = { stimulus_set: { type: 'shapes' | 'symbols' | 'digits'; set?: string; values: (string | number)[] }; target_rate: number };
const num = (v: unknown, d: number) => (typeof v === 'number' ? v : Number(v ?? d));

function build(rng: Rng, rule: Rule, n: number, count: number, lureRate: number, stimMs: number, isi: number): TrialSpec[] {
  const vals = rule.stimulus_set.values;
  const isTarget = binarySequence(rng, { n: count, rate: rule.target_rate, maxRun: 2, noTargetFirst: n });
  const seq: (string | number)[] = [];
  const cond: string[] = [];
  for (let i = 0; i < count; i++) {
    if (i >= n && isTarget[i]) { seq.push(seq[i - n]!); cond.push('target'); continue; }
    const back = i >= n ? seq[i - n] : undefined;
    const lureSources = [n - 1, n + 1].filter((d) => d >= 1 && i - d >= 0).map((d) => seq[i - d]!).filter((v) => v !== back);
    if (i > n && lureSources.length && rng.next() < lureRate) { seq.push(lureSources[Math.floor(rng.next() * lureSources.length)]!); cond.push('lure'); continue; }
    const avoid = new Set([back, ...lureSources]);
    const pool = vals.filter((v) => !avoid.has(v));
    seq.push(pool[Math.floor(rng.next() * pool.length)]!);
    cond.push('nontarget');
  }
  const stim = (v: string | number): Stimulus => (rule.stimulus_set.type === 'shapes' ? { kind: 'shape', spec: { shape: v as ShapeName, fill: 'solid', size: 'l', rot: 0 } } : rule.stimulus_set.type === 'digits' ? { kind: 'digit', value: Number(v) } : { kind: 'symbol', id: Number(v), set: rule.stimulus_set.set ?? 'high' });
  return seq.map((v, i) => ({
    index: i,
    stimulus: stim(v),
    foreperiod_ms: i === 0 ? 1000 : 0,
    stimulus_duration_ms: stimMs,
    response_window_ms: stimMs + isi,
    correct: cond[i] === 'target' ? 'match' : null,
    condition: cond[i]!,
    meta: { value: String(v) },
  }));
}

const expand: ExpanderFn = ({ item, levers, rng, timeScale }) => {
  const phases = item.blueprint.phases;
  const rule = phases.find((p) => p.phase === 'trials')!.trial_rule as unknown as Rule;
  const n = Math.round(num(levers.n, 2));
  return {
    task_type: item.task_type,
    instruction_text: phases.find((p) => p.phase === 'instructions')?.instruction_text ?? '',
    rule_reminder: String((item.blueprint as Record<string, unknown>).rule_reminder ?? ''),
    responses: [{ id: 'match', label: 'Match', key: ' ' }],
    persistent: null,
    persistent_position: 'top',
    mode: 'paced',
    duration_s: null,
    practice: build(rng.fork('practice'), rule, n, scaled(num(levers.practice_trials, 12), 1, 8), 0, 600, 2200),
    trials: build(rng.fork('trials'), rule, n, scaled(num(levers.trials, 30), timeScale, 30), num(levers.lure_rate, 0.1), num(levers.stimulus_duration_ms, 500), num(levers.isi_ms, 2000)),
    practice_pass_accuracy: 0.7,
    nudge: null,
    feedback_in_practice: true,
    time_scale: timeScale,
  };
};

export default expand;
