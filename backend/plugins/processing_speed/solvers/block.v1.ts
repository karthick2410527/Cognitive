// processing_speed.block.v1 — every trial's correct response must be derivable from the visible
// key / mapping; no immediate symbol repeats; balanced alternatives; the key is persistent.
import { createRng, maxRunOfAny, type ExpanderFn, type SolverFn } from '@cognimetric/core';
import simple from '../expanders/simpleRt.v1';
import substitution from '../expanders/substitution.v1';
import choice from '../expanders/choiceRt.v1';

const EXP: Record<string, ExpanderFn> = { simple_rt_block: simple, symbol_substitution_block: substitution, choice_rt_block: choice };

const solve: SolverFn = ({ item, levers }) => {
  const exp = EXP[item.task_type];
  if (!exp) return { verdict: 'not_solvable_by_rule' };
  if (Number(levers.block_duration_s ?? 60) > 120) return { verdict: 'lever_mismatch', detail: 'blocks may not exceed 120 s' };
  for (const seed of [3, 1001, 65537]) {
    const b = exp({ item, levers, seed, rng: createRng(seed), timeScale: 1 });
    if (item.task_type === 'symbol_substitution_block') {
      if (!b.persistent || b.persistent.kind !== 'symbol_key') return { verdict: 'no_rule', detail: 'the symbol key must stay on screen' };
      const digit = new Map(b.persistent.pairs.map((p) => [p.symbol, String(p.digit)]));
      for (const t of b.trials) {
        if (t.stimulus.kind !== 'symbol_row') return { verdict: 'no_rule', detail: 'unexpected stimulus' };
        const sym = t.stimulus.ids[t.stimulus.highlight]!;
        if (digit.get(sym) !== t.correct) return { verdict: 'key_mismatch', detail: `trial ${t.index}: key lookup disagrees` };
      }
      for (let i = 1; i < b.trials.length; i++) if (b.trials[i]!.meta?.symbol === b.trials[i - 1]!.meta?.symbol) return { verdict: 'no_rule', detail: 'immediate symbol repeat' };
    } else if (item.task_type === 'choice_rt_block') {
      for (const t of b.trials) {
        const id = t.stimulus.kind === 'shape' ? t.stimulus.spec.shape : t.stimulus.kind === 'digit' ? String(t.stimulus.value) : null;
        if (id === null || id !== t.correct || !b.responses.some((r) => r.id === id)) return { verdict: 'key_mismatch', detail: `trial ${t.index}` };
      }
      if (maxRunOfAny(b.trials.map((t) => t.correct)) > 3) return { verdict: 'no_rule', detail: 'more than 3 identical responses in a row' };
    } else {
      if (b.trials.some((t) => t.correct !== 'go' || t.foreperiod_ms < 1000 || t.foreperiod_ms > 3000)) return { verdict: 'no_rule', detail: 'foreperiod outside 1000–3000 ms' };
    }
  }
  return { verdict: 'key_confirmed' };
};

export default solve;
