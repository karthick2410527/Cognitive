// executive.block.v1 — verifies expanded interference and n-back sequences (Doc 07 §7).
import { createRng, type ExpanderFn, type SolverFn, type TrialSpec } from '@cognimetric/core';
import interference from '../expanders/interference.v1';
import nback from '../expanders/nback.v1';

const EXP: Record<string, ExpanderFn> = { interference_block: interference, n_back_block: nback };

function check(type: string, trials: TrialSpec[], levers: Record<string, unknown>): string | null {
  const n = trials.length;
  if (type === 'interference_block') {
    const c = trials.filter((t) => t.condition === 'congruent').length / n;
    if (Math.abs(c - Number(levers.congruency_ratio)) > 0.02 + 0.5 / n) return `congruency ${c.toFixed(3)}`;
    const left = trials.filter((t) => t.correct === 'L').length;
    if (Math.abs(2 * left - n) / n > 0.05) return 'response sides unbalanced';
    for (const t of trials) {
      const s = t.stimulus;
      if (s.kind === 'positioned' && s.child.kind === 'arrows') {
        if (s.child.dirs[0] !== t.correct) return `trial ${t.index}: key is not the arrow direction`;
        const side = s.x < 0 ? 'L' : 'R';
        if ((side === t.correct) !== (t.condition === 'congruent')) return `trial ${t.index}: condition label wrong`;
      } else if (s.kind === 'pair' && s.left.kind === 'digit' && s.right.kind === 'digit') {
        if ((s.left.value > s.right.value ? 'L' : 'R') !== t.correct) return `trial ${t.index}: key is not the larger value`;
      } else return 'unexpected stimulus';
    }
  } else {
    const k = Math.round(Number(levers.n));
    const vals = trials.map((t) => String(t.meta?.value));
    for (let i = 0; i < n; i++) {
      const isMatch = i >= k && vals[i] === vals[i - k];
      if (isMatch !== (trials[i]!.correct === 'match')) return `trial ${i}: target not derivable from the ${k}-back rule`;
    }
    const lures = trials.filter((t) => t.condition === 'lure').length / n;
    if (Number(levers.lure_rate) > 0 && Math.abs(lures - Number(levers.lure_rate) * 0.7) > 0.12) return `lure rate ${lures.toFixed(3)} far from lever`;
  }
  return null;
}

const solve: SolverFn = ({ item, levers }) => {
  const exp = EXP[item.task_type];
  if (!exp) return { verdict: 'not_solvable_by_rule' };
  for (const seed of [7, 4242, 31337]) {
    const block = exp({ item, levers, seed, rng: createRng(seed), timeScale: 1 });
    const problem = check(item.task_type, block.trials, levers);
    if (problem) return { verdict: 'no_rule', detail: `seed ${seed}: ${problem}` };
  }
  return { verdict: 'key_confirmed' };
};

export default solve;
