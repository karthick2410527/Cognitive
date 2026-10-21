import type { SolverFn } from '@cognimetric/core';
import { SHAPES } from '../author/choice';

const solve: SolverFn = ({ item }) => {
  const opts = item.blueprint.phases[0]?.options ?? [];
  const hits = opts.map((o, i) => (SHAPES.includes(o) ? i : -1)).filter((i) => i >= 0);
  if (hits.length !== 1) return { verdict: hits.length ? 'multiple_solutions' : 'no_solution' };
  return item.answer_key.kind === 'index' && item.answer_key.value === hits[0] ? { verdict: 'key_confirmed' } : { verdict: 'key_mismatch' };
};
export default solve;
