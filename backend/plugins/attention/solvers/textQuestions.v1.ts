// attention.textQuestions.v1 — re-derives the key of the written attention questions from what is on
// screen, and checks the item realises its levers (code length, confusability, line length, letter
// similarity, option count). Shared with nothing the author used except the character tables.
import type { SolverFn } from '@cognimetric/core';
import { PAIR_SEP, groupOf, isConfusable } from '../author/textCodes';

const solve: SolverFn = ({ item, levers }) => {
  const p = item.blueprint.phases[0] as { stem?: string; options?: string[]; instruction_text?: string; display?: string };
  const options = p.options ?? [];
  if (item.answer_key.kind !== 'index') return { verdict: 'key_mismatch', detail: 'index key required' };
  const key = item.answer_key.value;
  if (typeof levers.option_count === 'number' && options.length !== levers.option_count) return { verdict: 'lever_mismatch', detail: 'option_count' };

  if (item.task_type === 'mismatch_pair') {
    const pairs = options.map((o) => o.split(PAIR_SEP).map((s) => s.trim()));
    if (pairs.some((x) => x.length !== 2 || !x[0] || !x[1])) return { verdict: 'no_rule', detail: `every option must be two codes separated by "${PAIR_SEP.trim()}"` };
    const odd = pairs.map((x, i) => (x[0] !== x[1] ? i : -1)).filter((i) => i >= 0);
    if (odd.length === 0) return { verdict: 'no_solution', detail: 'every pair matches' };
    if (odd.length > 1) return { verdict: 'multiple_solutions', detail: `rows ${odd.map((i) => i + 1).join(', ')} all differ` };
    const [a, b] = pairs[odd[0]!]! as [string, string];
    if (a.length !== b.length) return { verdict: 'lever_mismatch', detail: 'the codes in the key row differ in length' };
    const diffs = [...a].map((c, i) => (c !== b[i] ? i : -1)).filter((i) => i >= 0);
    if (diffs.length !== 1) return { verdict: 'lever_mismatch', detail: `the key row differs in ${diffs.length} characters, expected exactly 1` };
    if (typeof levers.code_length === 'number' && pairs.some((x) => x[0]!.length !== levers.code_length)) return { verdict: 'lever_mismatch', detail: 'code_length' };
    const conf = isConfusable(a[diffs[0]!]!, b[diffs[0]!]!);
    if (levers.difference_confusability === 'similar' && !conf) return { verdict: 'lever_mismatch', detail: 'the changed character is not a look-alike' };
    if (levers.difference_confusability === 'dissimilar' && conf) return { verdict: 'lever_mismatch', detail: 'the changed character is a look-alike' };
    return odd[0] === key ? { verdict: 'key_confirmed', derived_key: key } : { verdict: 'key_mismatch', derived_key: odd[0], detail: `row ${odd[0]! + 1} is the mismatch` };
  }

  if (item.task_type === 'letter_count') {
    const target = /letter\s+["“']?([A-Z])\b/.exec(p.stem ?? '')?.[1];
    if (!target) return { verdict: 'no_rule', detail: 'the question must name one capital letter' };
    const line = (p.display ?? '').trim().split(/\s+/);
    if (line.some((c) => !/^[A-Z]$/.test(c))) return { verdict: 'no_rule', detail: 'display must be single capital letters separated by spaces' };
    if (typeof levers.line_length === 'number' && line.length !== levers.line_length) return { verdict: 'lever_mismatch', detail: `line has ${line.length} letters, line_length is ${levers.line_length}` };
    const count = line.filter((c) => c === target).length;
    const others = line.filter((c) => c !== target);
    const near = others.filter((c) => groupOf(target).includes(c)).length / Math.max(1, others.length);
    if (levers.letter_similarity === 'similar' && near < 0.6) return { verdict: 'lever_mismatch', detail: 'too few look-alike letters' };
    if (levers.letter_similarity === 'dissimilar' && near > 0.1) return { verdict: 'lever_mismatch', detail: 'look-alike letters present' };
    const hits = options.map((o, i) => (Number(o.trim()) === count ? i : -1)).filter((i) => i >= 0);
    if (!hits.length) return { verdict: 'no_solution', detail: `no option says ${count}` };
    if (hits.length > 1) return { verdict: 'multiple_solutions' };
    return hits[0] === key ? { verdict: 'key_confirmed', derived_key: key } : { verdict: 'key_mismatch', derived_key: hits[0], detail: `the letter appears ${count} times` };
  }
  return { verdict: 'not_solvable_by_rule', detail: `no rule for ${item.task_type}` };
};

export default solve;
