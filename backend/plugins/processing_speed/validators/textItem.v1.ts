// Forbidden patterns for the written speed questions: short, unambiguous, always time-limited.
import { words, type GateIssue, type ValidatorFn } from '@cognimetric/core';

const validate: ValidatorFn = ({ item, levers }) => {
  const issues: GateIssue[] = [];
  const p = item.blueprint.phases[0] as { stem?: string; options?: string[]; instruction_text?: string };
  if (words(p.instruction_text ?? '').length > 12) issues.push({ code: 'instructions_too_long', path: 'blueprint.phases[0].instruction_text', message: 'Speed questions need a one-line instruction.', severity: 'fail' });
  if (typeof levers.time_limit_ms !== 'number' || levers.time_limit_ms > 15000) issues.push({ code: 'untimed_speed_item', path: 'levers.time_limit_ms', message: 'A written speed question needs a time limit of 15 s or less.', severity: 'fail' });
  if (item.task_type === 'code_match' && (p.options ?? []).some((o) => /[a-z]/.test(o))) issues.push({ code: 'lowercase_in_code', path: 'blueprint.phases[0].options', message: 'Codes use capital letters and digits only.', severity: 'fail' });
  return issues;
};

export default validate;
