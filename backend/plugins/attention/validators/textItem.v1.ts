// Forbidden patterns for the written attention questions (Doc 06 §8 applied to single items).
import { words, type GateIssue, type ValidatorFn } from '@cognimetric/core';

const COLOUR = /\b(red|green|blue|yellow|orange|purple|pink|brown|colou?r)\b/i;

const validate: ValidatorFn = ({ item }) => {
  const issues: GateIssue[] = [];
  const p = item.blueprint.phases[0] as { stem?: string; options?: string[]; instruction_text?: string };
  const text = `${p.instruction_text ?? ''} ${p.stem ?? ''}`;
  if (words(p.instruction_text ?? '').length > 40) issues.push({ code: 'instructions_too_long', path: 'blueprint.phases[0].instruction_text', message: 'Instructions must be 40 words or fewer.', severity: 'fail' });
  if (COLOUR.test(text)) issues.push({ code: 'colour_encoding', path: 'blueprint.phases[0]', message: 'Nothing may be distinguished by colour.', severity: 'fail' });
  // Codes and letter lines must be meaningless strings, never words (semantic content is a confound).
  if (item.task_type === 'mismatch_pair' && (p.options ?? []).some((o) => /[a-z]/.test(o))) issues.push({ code: 'lowercase_in_code', path: 'blueprint.phases[0].options', message: 'Codes use capital letters and digits only.', severity: 'fail' });
  return issues;
};

export default validate;
