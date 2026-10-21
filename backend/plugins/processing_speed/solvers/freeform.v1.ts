// Free-form written questions cannot be solved by rule. Their key stands only if the independent check
// recorded with the item (a second model call that answered without seeing the key) chose the same
// option and found exactly one defensible answer.
import type { SolverFn } from '@cognimetric/core';

type Check = { answer_index: number; exactly_one_defensible: boolean; problem?: string | null } | null | undefined;

const solve: SolverFn = ({ item }) => {
  if (item.answer_key.kind !== 'index') return { verdict: 'key_mismatch', detail: 'index key required' };
  const check = (item as { freeform_check?: Check }).freeform_check;
  if (!check) return { verdict: 'not_solvable_by_rule', detail: 'no independent answer check recorded' };
  if (!check.exactly_one_defensible) return { verdict: 'multiple_solutions', detail: check.problem ?? 'the check found no single defensible answer' };
  return check.answer_index === item.answer_key.value
    ? { verdict: 'key_confirmed', derived_key: check.answer_index }
    : { verdict: 'key_mismatch', derived_key: check.answer_index, detail: `the independent check chose option ${check.answer_index}` };
};

export default solve;
