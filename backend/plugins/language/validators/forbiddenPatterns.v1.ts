// Language forbidden patterns as code (Doc 08 §8).
import type { GateIssue, ValidatorFn } from '@cognimetric/core';

const LOADED = /\b(death|die|dying|dead|kill|blood|cancer|dementia|alzheimer|disease|sick|illness|pain|grief|funeral|suicide|war|gun|weapon|hospital)\b/i;

const validate: ValidatorFn = ({ item }) => {
  const issues: GateIssue[] = [];
  const p = item.blueprint.phases[0] as { stem?: string; options?: string[] };
  const stem = p.stem ?? '';
  const options = p.options ?? [];
  if (/\d/.test(stem) || options.some((o) => /\d/.test(o))) issues.push({ code: 'numerals', path: 'blueprint.phases[0]', message: 'No numerals or arithmetic in language items.', severity: 'fail' });
  const midCaps = stem.replace(/^\W*\w+/, '').match(/(?<![.!?]\s)\b[A-Z][a-z]+/g) ?? [];
  if (midCaps.length) issues.push({ code: 'proper_noun', path: 'blueprint.phases[0].stem', message: `Possible proper noun: ${midCaps.join(', ')}`, severity: 'quarantine' });
  if (options.some((o) => /^[A-Z]/.test(o))) issues.push({ code: 'proper_noun_option', path: 'blueprint.phases[0].options', message: 'Options must be common nouns.', severity: 'fail' });
  if (LOADED.test(stem) || options.some((o) => LOADED.test(o))) issues.push({ code: 'loaded_vocabulary', path: 'blueprint.phases[0]', message: 'Emotionally loaded or clinical vocabulary.', severity: 'fail' });
  if (item.task_type === 'word_definition_choice' && item.answer_key.kind === 'index') {
    const key = options[item.answer_key.value]?.toLowerCase() ?? '';
    if (key && stem.toLowerCase().includes(key)) issues.push({ code: 'definition_contains_key', path: 'blueprint.phases[0].stem', message: 'The definition contains the key word.', severity: 'fail' });
  }
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) issues.push({ code: 'duplicate_options', path: 'blueprint.phases[0].options', message: 'Options must be distinct.', severity: 'fail' });
  return issues;
};

export default validate;
