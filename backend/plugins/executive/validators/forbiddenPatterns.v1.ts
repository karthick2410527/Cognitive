// Executive forbidden patterns as code (Doc 07 §7).
import { words, type GateIssue, type ValidatorFn } from '@cognimetric/core';

const RULE_WORDS = /\b(rotat\w*|increas\w*|decreas\w*|add\w*|subtract\w*|plus|minus|bigger|smaller|grows?|turns?|clockwise|each row|each column)\b/i;
const NOTA = /(none of the above|i don't know|not sure)/i;

const validate: ValidatorFn = ({ item, levers }) => {
  const issues: GateIssue[] = [];
  const bp = item.blueprint as Record<string, unknown> & { phases: { phase: string; stem?: string; instruction_text?: string; trial_rule?: Record<string, unknown> }[] };
  if (item.task_type === 'matrix_completion') {
    const stem = bp.phases[0]?.stem ?? '';
    if (RULE_WORDS.test(stem)) issues.push({ code: 'rule_stated_in_words', path: 'blueprint.phases[0].stem', message: 'The rule must not be stated on screen; that removes the induction.', severity: 'fail' });
    if (NOTA.test(JSON.stringify(bp.options ?? ''))) issues.push({ code: 'none_of_the_above', path: 'blueprint.options', message: "No 'none of the above' options.", severity: 'fail' });
    const colours = ((bp.puzzle as Record<string, unknown>)?.alphabet as { colours?: string[] })?.colours ?? ['ink'];
    if (colours.some((c) => c !== 'ink')) issues.push({ code: 'colour_rule', path: 'blueprint.puzzle.alphabet.colours', message: 'Colour may not carry information unless the task type declares colour_dependent.', severity: 'fail' });
  } else {
    const instr = bp.phases.find((p) => p.phase === 'instructions')?.instruction_text ?? '';
    if (words(instr).length > 40) issues.push({ code: 'instructions_too_long', path: 'blueprint.phases.instructions', message: 'Instructions must be 40 words or fewer.', severity: 'fail' });
    if (!bp.rule_reminder) issues.push({ code: 'rule_not_visible', path: 'blueprint.rule_reminder', message: 'The response rule must stay on screen.', severity: 'fail' });
    if (item.task_type === 'n_back_block' && Number(levers.n) >= 2 && Number(levers.lure_rate) <= 0) issues.push({ code: 'nback_without_lures', path: 'levers.lure_rate', message: 'n-back above θ = 0 needs lures.', severity: 'fail' });
  }
  return issues;
};

export default validate;
