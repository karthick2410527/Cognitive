// language.lexical.v1 — every word is looked up in the locale's lexical service and checked
// against the requested levers; then the item's relation is re-derived (Doc 08 §8). An item whose
// words do not match its claimed levers is rejected: without this the levers are decorative.
import type { LexEntry, SolverFn } from '@cognimetric/core';
import { DISTANCE, bandViolations, glossOverlap } from '../author/bands';

const solve: SolverFn = ({ item, levers, services }) => {
  const lex = services.lexicon;
  if (!lex) return { verdict: 'not_solvable_by_rule', detail: 'lexical service unavailable' };
  const phase = item.blueprint.phases[0] as { stem?: string; options?: string[]; target?: string };
  const options = phase.options ?? [];
  if (item.answer_key.kind !== 'index') return { verdict: 'key_mismatch', detail: 'index key required' };
  const entries = options.map((w) => lex.lookup(w.toLowerCase()));
  const missing = options.filter((_, i) => !entries[i]);
  if (missing.length) return { verdict: 'lever_mismatch', detail: `not in the ${lex.locale} lexicon: ${missing.join(', ')}` };
  const E = entries as LexEntry[];
  if (typeof levers.option_count === 'number' && options.length !== levers.option_count) return { verdict: 'lever_mismatch', detail: 'option_count' };
  const keyIdx = item.answer_key.value;
  const dist = String(levers.option_semantic_distance ?? '');
  let derived: number[] = [];

  if (item.task_type === 'semantic_odd_one_out') {
    // The odd word is the unique option outside the majority subcategory (or, when the majority spans
    // several subcategories of one category, outside that category). A majority that itself splits
    // into a sub-group offers a second odd one out.
    for (const level of ['subcategory', 'category'] as const) {
      const counts = new Map<string, number>();
      for (const e of E) counts.set(e[level], (counts.get(e[level]) ?? 0) + 1);
      const big = [...counts.entries()].find(([, c]) => c === E.length - 1);
      if (big) { derived = E.map((e, i) => (e[level] !== big[0] ? i : -1)).filter((i) => i >= 0); break; }
    }
    if (derived.length === 1) {
      const k = E[derived[0]!]!;
      const rest = E.filter((_, i) => i !== derived[0]);
      const sameSub = rest.every((e) => e.subcategory === rest[0]!.subcategory);
      const distinctSubs = new Set(rest.map((e) => e.subcategory)).size === rest.length && rest.every((e) => e.category === rest[0]!.category);
      if (!sameSub && !distinctSubs) return { verdict: 'multiple_solutions', detail: 'the other words split into a sub-group, so a second option is also odd' };
      if (dist) {
        const d = Math.min(...rest.map((e) => lex.semanticDistance(k.word, e.word)));
        const expect = dist === 'unrelated' ? 2 : 1;
        if (d !== expect) return { verdict: 'lever_mismatch', detail: `odd word is ${d === 2 ? 'from another category' : 'from the same category'}; lever ${dist} expects ${expect === 2 ? 'another category' : 'the same category'}` };
        if (expect === 1 && !sameSub) return { verdict: 'lever_mismatch', detail: 'for a same-category odd word, the other words must share one subcategory' };
      }
    }
  } else if (item.task_type === 'semantic_association') {
    // The target word is in `target`, or quoted in the stem (Which word goes best with "island"?).
    const target = lex.lookup(String(phase.target ?? (phase.stem ?? '').match(/["“']([A-Za-z]+)["”']/)?.[1] ?? '').toLowerCase());
    if (!target) return { verdict: 'no_solution', detail: 'association target word is not in the lexicon' };
    const d = E.map((e) => lex.semanticDistance(target.word, e.word));
    const best = Math.min(...d);
    derived = d.map((x, i) => (x === best ? i : -1)).filter((i) => i >= 0);
    if (derived.length === 1 && dist) {
      const rest = d.filter((_, i) => i !== derived[0]);
      if (rest.some((x) => x - best < 1)) return { verdict: 'multiple_solutions', detail: 'key is not strictly closer than every distractor' };
      if (rest.some((x) => x !== DISTANCE[dist])) return { verdict: 'lever_mismatch', detail: 'distractor distance does not match the lever' };
    }
  } else if (item.task_type === 'word_definition_choice') {
    const stem = phase.stem ?? '';
    const scores = E.map((e) => glossOverlap(stem, e.gloss));
    const sorted = [...scores].sort((a, b) => b - a);
    if (sorted[0]! < 0.2) return { verdict: 'no_solution', detail: 'definition matches no option gloss' };
    if (sorted[0]! - sorted[1]! < 0.15) return { verdict: 'multiple_solutions', detail: 'definition fits more than one option' };
    derived = [scores.indexOf(sorted[0]!)];
    const want = dist === 'same_narrow_category' ? 0 : DISTANCE[dist];
    if (want !== undefined && E.some((e, i) => i !== derived[0] && lex.semanticDistance(E[derived[0]!]!.word, e.word) !== want))
      return { verdict: 'lever_mismatch', detail: 'distractor relation does not match the lever' };
  } else return { verdict: 'not_solvable_by_rule' };

  if (derived.length === 0) return { verdict: 'no_solution', detail: 'no option satisfies the relation' };
  if (derived.length > 1) return { verdict: 'multiple_solutions', detail: `options ${derived.join(',')} all satisfy the relation` };
  const viol = bandViolations(E[derived[0]!]!, levers);
  if (viol.length) return { verdict: 'lever_mismatch', detail: viol.join('; ') };
  if (derived[0] !== keyIdx) return { verdict: 'key_mismatch', derived_key: derived[0], detail: `solver derives option ${derived[0]}` };
  return { verdict: 'key_confirmed', derived_key: derived[0] };
};

export default solve;
