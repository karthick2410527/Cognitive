import type { ExpanderFn, Rng, TrialSpec } from '@cognimetric/core';

type Rule = { symbol_set: string; key: { symbol: number; digit: number }[] };

function build(rng: Rng, rule: Rule, n: number, density: number): TrialSpec[] {
  const seq: number[] = [];
  for (let i = 0; i < n; i++) {
    const pool = rule.key.filter((p) => p.symbol !== seq[i - 1]);
    seq.push(pool[Math.floor(rng.next() * pool.length)]!.symbol);
  }
  const digitOf = new Map(rule.key.map((p) => [p.symbol, p.digit]));
  return seq.map((s, i) => {
    const row = Math.floor(i / density);
    const ids = seq.slice(row * density, row * density + density);
    return {
      index: i,
      stimulus: { kind: 'symbol_row', set: rule.symbol_set, ids, highlight: i % density },
      foreperiod_ms: 0,
      stimulus_duration_ms: null,
      response_window_ms: 15000,
      correct: String(digitOf.get(s)),
      condition: 'substitution',
      meta: { symbol: s },
    } satisfies TrialSpec;
  });
}

const expand: ExpanderFn = ({ item, levers, rng, timeScale }) => {
  const rule = item.blueprint.phases.find((p) => p.phase === 'trials')!.trial_rule as unknown as Rule;
  const density = Number(levers.stimulus_density ?? 12);
  const duration = Math.max(20, Number(levers.block_duration_s ?? 90) * timeScale);
  return {
    task_type: item.task_type,
    instruction_text: item.blueprint.phases.find((p) => p.phase === 'instructions')?.instruction_text ?? '',
    rule_reminder: String((item.blueprint as Record<string, unknown>).rule_reminder ?? ''),
    responses: rule.key.map((p) => ({ id: String(p.digit), label: String(p.digit), key: String(p.digit) })),
    persistent: { kind: 'symbol_key', set: rule.symbol_set, pairs: rule.key },
    persistent_position: levers.key_position === 'top' ? 'top' : 'adjacent',
    mode: 'self_paced',
    duration_s: duration,
    practice: build(rng.fork('practice'), rule, Number(levers.practice_trials ?? 8), density),
    trials: build(rng.fork('trials'), rule, Math.ceil(duration * 3), density),
    practice_pass_accuracy: 0.75,
    nudge: null,
    feedback_in_practice: true,
    time_scale: timeScale,
  };
};

export default expand;
