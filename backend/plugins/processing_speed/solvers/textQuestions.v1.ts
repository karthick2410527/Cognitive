// processing_speed.textQuestions.v1 — re-derives the key of the written speed questions from the
// screen: the exact copy of the code, or the value of the sum; checks the levers it can see.
import type { SolverFn } from '@cognimetric/core';

const OPS: Record<string, (a: number, b: number) => number> = { '+': (a, b) => a + b, '-': (a, b) => a - b, '−': (a, b) => a - b, '×': (a, b) => a * b, x: (a, b) => a * b, '*': (a, b) => a * b };

function operationOf(a: number, op: string, b: number): string {
  if (op === '+') return a < 10 && b < 10 ? 'add_single' : 'add_double';
  if (op === '×' || op === 'x' || op === '*') return 'multiply_single';
  return b < 10 && a < 20 ? 'subtract_single' : 'subtract_double';
}

const solve: SolverFn = ({ item, levers }) => {
  const p = item.blueprint.phases[0] as { stem?: string; options?: string[] };
  const options = (p.options ?? []).map((o) => o.trim());
  if (item.answer_key.kind !== 'index') return { verdict: 'key_mismatch', detail: 'index key required' };
  const key = item.answer_key.value;
  if (typeof levers.option_count === 'number' && options.length !== levers.option_count) return { verdict: 'lever_mismatch', detail: 'option_count' };
  let hits: number[];
  if (item.task_type === 'code_match') {
    const target = (p.stem ?? '').trim();
    if (!/^[A-Z0-9]+$/.test(target)) return { verdict: 'no_rule', detail: 'the stem must be one code of capital letters and digits' };
    if (typeof levers.code_length === 'number' && target.length !== levers.code_length) return { verdict: 'lever_mismatch', detail: 'code_length' };
    if (options.some((o) => o.length !== target.length)) return { verdict: 'lever_mismatch', detail: 'every option must have the code length' };
    hits = options.map((o, i) => (o === target ? i : -1)).filter((i) => i >= 0);
  } else if (item.task_type === 'quick_arithmetic') {
    const m = /^\s*(\d+)\s*([+\-−×x*])\s*(\d+)\s*=\s*\?\s*$/.exec(p.stem ?? '');
    if (!m) return { verdict: 'no_rule', detail: 'the stem must be "a op b = ?"' };
    const a = Number(m[1]), b = Number(m[3]);
    const r = OPS[m[2]!]!(a, b);
    if (levers.arithmetic_operation && operationOf(a, m[2]!, b) !== levers.arithmetic_operation) return { verdict: 'lever_mismatch', detail: `${a} ${m[2]} ${b} is ${operationOf(a, m[2]!, b)}` };
    hits = options.map((o, i) => (Number(o) === r ? i : -1)).filter((i) => i >= 0);
  } else return { verdict: 'not_solvable_by_rule', detail: `no rule for ${item.task_type}` };
  if (!hits.length) return { verdict: 'no_solution' };
  if (hits.length > 1) return { verdict: 'multiple_solutions' };
  return hits[0] === key ? { verdict: 'key_confirmed', derived_key: key } : { verdict: 'key_mismatch', derived_key: hits[0] };
};

export default solve;
