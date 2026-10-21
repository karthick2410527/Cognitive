// Attention forbidden patterns as code (Doc 06 §8).
import { words, type GateIssue, type ValidatorFn } from '@cognimetric/core';

const COLOUR = /\b(red|green|blue|yellow|orange|purple|pink|brown|colou?r)\b/i;

const validate: ValidatorFn = ({ item }) => {
  const issues: GateIssue[] = [];
  const bp = item.blueprint as Record<string, unknown> & { phases: { phase: string; instruction_text?: string; trial_rule?: Record<string, unknown> }[] };
  const instr = bp.phases.find((p) => p.phase === 'instructions')?.instruction_text ?? '';
  if (words(instr).length > 40) issues.push({ code: 'instructions_too_long', path: 'blueprint.phases.instructions', message: 'Instructions longer than 40 words make comprehension the measured variable.', severity: 'fail' });
  if (!instr) issues.push({ code: 'missing_instructions', path: 'blueprint.phases', message: 'A timed block needs an instructions phase.', severity: 'fail' });
  if (!bp.rule_reminder) issues.push({ code: 'rule_not_visible', path: 'blueprint.rule_reminder', message: 'The rule must stay visible on screen (no rule held in memory).', severity: 'fail' });
  if (COLOUR.test(instr)) issues.push({ code: 'colour_encoding', path: 'blueprint.phases.instructions', message: 'Stimuli must not be distinguished by colour.', severity: 'fail' });
  const rule = bp.phases.find((p) => p.phase === 'trials')?.trial_rule ?? {};
  if (Array.isArray(rule.rules) && rule.rules.length > 1) issues.push({ code: 'rule_change_in_block', path: 'blueprint.phases.trials.trial_rule', message: 'More than one rule inside a block makes it a switching task.', severity: 'fail' });
  const set = (rule.stimulus_set as { type?: string })?.type;
  if (set && !['digits', 'shapes', 'symbols'].includes(set)) issues.push({ code: 'semantic_stimuli', path: 'blueprint.phases.trials.trial_rule.stimulus_set', message: 'Stimuli must be digits, shapes, abstract symbols or arrows.', severity: 'fail' });
  if (rule.kind === 'search_grid') {
    const t = rule.target as Record<string, unknown>;
    for (const d of (rule.distractor_pool as Record<string, unknown>[]) ?? []) {
      const diffs = ['shape', 'fill', 'rot', 'size'].filter((k) => d[k] !== t[k]).length;
      if (diffs !== 1) issues.push({ code: 'multi_feature_distractor', path: 'blueprint.phases.trials.trial_rule.distractor_pool', message: 'Distractors must differ from the target on exactly one feature.', severity: 'fail' });
    }
  }
  return issues;
};

export default validate;
