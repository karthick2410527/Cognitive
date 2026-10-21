import { words, type GateIssue, type ValidatorFn } from '@cognimetric/core';

const validate: ValidatorFn = ({ item }) => {
  const issues: GateIssue[] = [];
  const bp = item.blueprint as Record<string, unknown> & { phases: { phase: string; instruction_text?: string; stem?: string; options?: unknown[] }[] };
  const instr = bp.phases.find((p) => p.phase === 'instructions')?.instruction_text ?? '';
  if (words(instr).length > 40) issues.push({ code: 'instructions_too_long', path: 'blueprint.phases.instructions', message: 'Instructions must be 40 words or fewer.', severity: 'fail' });
  if (bp.phases.some((p) => p.phase === 'present' || p.options)) issues.push({ code: 'prose_item', path: 'blueprint.phases', message: 'Processing speed is measured by timed blocks, never by questions.', severity: 'fail' });
  if (!bp.rule_reminder) issues.push({ code: 'rule_not_visible', path: 'blueprint.rule_reminder', message: 'The response mapping must stay visible.', severity: 'fail' });
  return issues;
};

export default validate;
