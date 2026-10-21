// attention.block.v1 — verifies expanded trial sequences (Doc 06 §8): realised target rate within
// ±2 pp of the lever, ≤ 3 consecutive targets, response sides balanced within 5 %, no target in
// the first 5 trials, and every trial's correct response derivable from the rule.
import { createRng, maxRunOf, type ExpanderFn, type SolverFn, type TrialSpec } from '@cognimetric/core';
import sustained from '../expanders/sustained.v1';
import flanker from '../expanders/flanker.v1';
import search from '../expanders/search.v1';

const EXPANDERS: Record<string, ExpanderFn> = { sustained_response_block: sustained, flanker_block: flanker, visual_search_block: search };
const SEEDS = [11, 2027, 90210];

function check(taskType: string, trials: TrialSpec[], levers: Record<string, unknown>, rule: Record<string, unknown>): string | null {
  const n = trials.length;
  if (taskType === 'sustained_response_block') {
    const isT = trials.map((t) => t.condition === 'target');
    const rate = isT.filter(Boolean).length / n;
    if (Math.abs(rate - Number(levers.target_rate)) > 0.02 + 0.5 / n) return `target rate ${rate.toFixed(3)} vs ${levers.target_rate}`;
    if (maxRunOf(isT, true) > 3) return 'more than 3 consecutive targets';
    if (isT.slice(0, 5).some(Boolean)) return 'target within the first 5 trials';
    for (const t of trials) {
      const v = t.stimulus.kind === 'digit' ? t.stimulus.value : t.stimulus.kind === 'shape' ? t.stimulus.spec.shape : t.stimulus.kind === 'symbol' ? t.stimulus.id : null;
      const isTarget = v === rule.target;
      if ((t.correct === null) !== isTarget) return `trial ${t.index}: correct response not derivable from the rule`;
    }
  } else if (taskType === 'flanker_block') {
    const scored = trials.filter((t) => t.condition !== 'neutral');
    const cong = scored.filter((t) => t.condition === 'congruent').length / Math.max(1, scored.length);
    if (Math.abs(cong - Number(levers.congruency_ratio)) > 0.02 + 0.5 / n) return `congruency ${cong.toFixed(3)} vs ${levers.congruency_ratio}`;
    const left = trials.filter((t) => t.correct === 'L').length;
    if (Math.abs(left - (n - left)) / n > 0.05) return 'response sides unbalanced';
    for (const t of trials) {
      const s = t.stimulus.kind === 'positioned' ? t.stimulus.child : t.stimulus;
      if (s.kind !== 'arrows') return 'non-arrow stimulus';
      if (s.dirs[Math.floor(s.dirs.length / 2)] !== t.correct) return `trial ${t.index}: key is not the centre direction`;
    }
  } else if (taskType === 'visual_search_block') {
    const pres = trials.map((t) => t.correct === 'present');
    const rate = pres.filter(Boolean).length / n;
    if (Math.abs(rate - 0.5) > 0.02 + 0.5 / n) return `present rate ${rate.toFixed(3)}`;
    if (maxRunOf(pres, true) > 3 || maxRunOf(pres, false) > 3) return 'more than 3 identical responses in a row';
    const target = JSON.stringify(rule.target);
    for (const t of trials) {
      if (t.stimulus.kind !== 'grid') return 'non-grid stimulus';
      const has = t.stimulus.cells.some((c) => c && JSON.stringify(c) === target);
      if (has !== (t.correct === 'present')) return `trial ${t.index}: present/absent key wrong`;
    }
  }
  return null;
}

const solve: SolverFn = ({ item, levers }) => {
  const exp = EXPANDERS[item.task_type];
  if (!exp) return { verdict: 'not_solvable_by_rule', detail: 'no expander for task type' };
  const rule = (item.blueprint.phases.find((p) => p.phase === 'trials')?.trial_rule ?? {}) as Record<string, unknown>;
  for (const seed of SEEDS) {
    let block;
    try {
      block = exp({ item, levers, seed, rng: createRng(seed), timeScale: 1 });
    } catch (e) {
      return { verdict: 'no_rule', detail: `expansion failed: ${(e as Error).message}` };
    }
    const problem = check(item.task_type, block.trials, levers, rule);
    if (problem) return { verdict: 'no_rule', detail: `seed ${seed}: ${problem}` };
  }
  return { verdict: 'key_confirmed' };
};

export default solve;
