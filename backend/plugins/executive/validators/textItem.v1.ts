// Forbidden patterns for the written executive questions (Doc 07 §7 applied to number sequences).
import { words, type GateIssue, type ValidatorFn } from '@cognimetric/core';

const RULE_WORDS = /\b(add\w*|subtract\w*|plus|minus|times|double\w*|multipl\w*|increas\w*|decreas\w*|each time|step|rule is)\b/i;
const NOTA = /(none of the above|i don't know|not sure)/i;

const validate: ValidatorFn = ({ item }) => {
  const issues: GateIssue[] = [];
  const p = item.blueprint.phases[0] as { stem?: string; options?: string[]; instruction_text?: string };
  const text = `${p.instruction_text ?? ''} ${p.stem ?? ''}`;
  if (RULE_WORDS.test(text)) issues.push({ code: 'rule_stated_in_words', path: 'blueprint.phases[0]', message: 'The rule must not be stated on screen; that removes the induction.', severity: 'fail' });
  if ((p.options ?? []).some((o) => NOTA.test(o))) issues.push({ code: 'none_of_the_above', path: 'blueprint.phases[0].options', message: "No 'none of the above' options.", severity: 'fail' });
  if (words(p.instruction_text ?? '').length > 40) issues.push({ code: 'instructions_too_long', path: 'blueprint.phases[0].instruction_text', message: 'Instructions must be 40 words or fewer.', severity: 'fail' });
  if ((p.stem ?? '').split(/[,\s]+/).some((t) => t && t !== '?' && Math.abs(Number(t)) > 2000)) issues.push({ code: 'large_numbers', path: 'blueprint.phases[0].stem', message: 'Keep terms below 2000 so arithmetic load does not dominate.', severity: 'fail' });
  return issues;
};

export default validate;
