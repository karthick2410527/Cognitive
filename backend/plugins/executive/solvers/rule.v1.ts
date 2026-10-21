// executive.rule.v1 — wraps the engine's independent matrix solver (Doc 04 §7) and checks that
// the declared structure realises the requested levers.
import { OP_ARITY, solveMatrix, type MatrixCell, type MatrixPuzzle, type MatrixRule, type SolverFn } from '@cognimetric/core';

const ARITY_RANK = { unary: 0, binary: 1, ternary: 2 } as const;

const solve: SolverFn = ({ item, levers }) => {
  const bp = item.blueprint as unknown as { puzzle?: MatrixPuzzle; rule?: MatrixRule; options?: { items: MatrixCell[] } };
  if (!bp.puzzle || !bp.rule || !bp.options?.items?.length) return { verdict: 'no_solution', detail: 'puzzle, rule and options are required' };
  if (item.answer_key.kind !== 'index') return { verdict: 'key_mismatch', detail: 'matrix items use an index key' };
  const rels = bp.rule.relations ?? [];
  if (typeof levers.rule_count === 'number' && rels.length !== levers.rule_count) return { verdict: 'lever_mismatch', detail: `rule_count ${rels.length} ≠ ${levers.rule_count}` };
  const maxArity = typeof levers.relation_arity_max === 'string' ? ARITY_RANK[levers.relation_arity_max as keyof typeof ARITY_RANK] : 2;
  for (const r of rels) {
    if (OP_ARITY[r.op] === undefined) return { verdict: 'no_rule', detail: `operation ${r.op} is not in the taxonomy` };
    if (r.arity !== OP_ARITY[r.op]) return { verdict: 'no_rule', detail: `relation ${r.id} declares arity ${r.arity} for ${r.op}` };
    if (ARITY_RANK[r.arity] > maxArity) return { verdict: 'lever_mismatch', detail: `arity ${r.arity} exceeds relation_arity_max` };
  }
  const attrsPerRule = new Map<string, number>();
  for (const r of rels) attrsPerRule.set(r.attribute, (attrsPerRule.get(r.attribute) ?? 0) + 1);
  if ([...attrsPerRule.values()].some((n) => n > 1)) return { verdict: 'contradictory_rule', detail: 'more than one rule on the same attribute' };
  if (typeof levers.distracting_attributes === 'number' && bp.puzzle.distracting_attributes.length !== levers.distracting_attributes)
    return { verdict: 'lever_mismatch', detail: 'distracting_attributes' };
  const v = solveMatrix({ puzzle: bp.puzzle, rule: bp.rule, options: bp.options.items, keyIndex: item.answer_key.value });
  return v.verdict === 'key_confirmed' ? { verdict: 'key_confirmed', derived_key: v.matching[0] } : { verdict: v.verdict, detail: v.detail, derived_key: v.matching };
};

export default solve;
