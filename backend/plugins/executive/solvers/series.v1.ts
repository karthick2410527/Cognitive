// executive.series.v1 — re-derives the rule of a number sequence from the terms on screen.
// number_series: every rule family that fits must predict the same next term, and exactly one
// option must be it. odd_number_out: exactly one term must break a rule the other terms share.
import type { SolverFn } from '@cognimetric/core';
import { fits, parseTerms } from './seriesFit';

const solve: SolverFn = ({ item, levers }) => {
  const p = item.blueprint.phases[0] as { stem?: string; options?: string[] };
  const options = (p.options ?? []).map((o) => o.trim());
  if (item.answer_key.kind !== 'index') return { verdict: 'key_mismatch', detail: 'index key required' };
  const key = item.answer_key.value;
  const terms = parseTerms(p.stem ?? '');
  if (!terms.length || terms.some((t) => !Number.isFinite(t) || !Number.isInteger(t))) return { verdict: 'no_rule', detail: 'the stem must be whole numbers separated by commas' };
  if (typeof levers.terms_shown === 'number' && terms.length !== levers.terms_shown) return { verdict: 'lever_mismatch', detail: `${terms.length} terms shown, terms_shown is ${levers.terms_shown}` };
  const pts = terms.map((v, j) => [j, v] as [number, number]);

  if (item.task_type === 'number_series') {
    if (typeof levers.option_count === 'number' && options.length !== levers.option_count) return { verdict: 'lever_mismatch', detail: 'option_count' };
    const fs = fits(pts);
    if (!fs.length) return { verdict: 'no_rule', detail: 'no rule family fits the terms' };
    const preds = [...new Set(fs.map((f) => Math.round(f.at(terms.length))))];
    if (preds.length > 1) return { verdict: 'multiple_solutions', detail: `rules disagree on the next term: ${preds.join(' or ')}` };
    if (levers.series_rule && !fs.some((f) => f.rule === levers.series_rule)) return { verdict: 'lever_mismatch', detail: `sequence follows ${fs.map((f) => f.rule).join('/')}, not ${levers.series_rule}` };
    const hits = options.map((o, i) => (Number(o) === preds[0] ? i : -1)).filter((i) => i >= 0);
    if (!hits.length) return { verdict: 'no_solution', detail: `no option is ${preds[0]}` };
    if (hits.length > 1) return { verdict: 'multiple_solutions' };
    return hits[0] === key ? { verdict: 'key_confirmed', derived_key: key } : { verdict: 'key_mismatch', derived_key: hits[0], detail: `the next term is ${preds[0]}` };
  }

  if (item.task_type === 'odd_number_out') {
    if (options.length !== terms.length || options.some((o, i) => Number(o) !== terms[i])) return { verdict: 'no_rule', detail: 'the options must be the terms, in order' };
    if (fits(pts).length) return { verdict: 'no_solution', detail: 'every term already follows one rule' };
    const odd: number[] = [];
    const rules = new Set<string>();
    terms.forEach((v, j) => {
      const fs = fits(pts.filter(([y]) => y !== j)).filter((f) => Math.round(f.at(j)) !== v);
      if (fs.length) { odd.push(j); fs.forEach((f) => rules.add(f.rule)); }
    });
    if (!odd.length) return { verdict: 'no_rule', detail: 'no single term breaks a rule' };
    if (odd.length > 1) return { verdict: 'multiple_solutions', detail: `terms ${odd.map((j) => terms[j]).join(', ')} could each be the odd one` };
    if (levers.series_rule && !rules.has(String(levers.series_rule))) return { verdict: 'lever_mismatch', detail: `the other terms follow ${[...rules].join('/')}, not ${levers.series_rule}` };
    return odd[0] === key ? { verdict: 'key_confirmed', derived_key: key } : { verdict: 'key_mismatch', derived_key: odd[0], detail: `${terms[odd[0]!]} is the odd one` };
  }
  return { verdict: 'not_solvable_by_rule', detail: `no rule for ${item.task_type}` };
};

export default solve;
