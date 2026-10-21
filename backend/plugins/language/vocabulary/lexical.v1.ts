// Prompt vocabulary for lexicon-verified language items: the locale's word list grouped by category
// and subcategory, and the words that satisfy the current levers for the keyed answer. The solver
// checks every word against the same lexicon, so items built from this list can be verified.
import type { VocabularyFn } from '@cognimetric/core';
import { keyMatches } from '../author/bands';

const vocabulary: VocabularyFn = ({ levers, services, taskType }) => {
  const lex = services.lexicon;
  if (!lex) return null;
  const groups = new Map<string, string[]>();
  for (const e of lex.all()) groups.set(`${e.category} / ${e.subcategory}`, [...(groups.get(`${e.category} / ${e.subcategory}`) ?? []), e.word]);
  const keys = lex.all().filter((e) => keyMatches(e, levers));
  const role = taskType.id === 'semantic_odd_one_out' ? 'the odd word (the key)' : taskType.id === 'semantic_association' ? 'the keyed option' : 'the defined word (the key)';
  return [
    'ALLOWED VOCABULARY — use only these words (category / subcategory: words). Every word is looked up in this list.',
    ...[...groups.entries()].map(([k, ws]) => `${k}: ${ws.join(', ')}`),
    `KEY WORDS — ${role} must be one of these words, which satisfy word_frequency, age_of_acquisition and imageability as requested:`,
    keys.length ? keys.map((e) => `${e.word} (${e.subcategory})`).join(', ') : '(none: emit lever_conflict "word_frequency")',
    'Keep the other options close to the key in length and frequency so the options alone do not reveal it.',
    `RECIPE for ${taskType.id} at option_semantic_distance = ${String(levers.option_semantic_distance)} with ${String(levers.option_count)} options:`,
    recipe(taskType.id, String(levers.option_semantic_distance), Number(levers.option_count)),
  ].join('\n');
};

function recipe(task: string, dist: string, n: number): string {
  const unrelated = dist === 'unrelated';
  if (task === 'semantic_odd_one_out')
    return [
      `1. Pick the key from KEY WORDS.`,
      unrelated
        ? `2. Pick ONE subcategory from a DIFFERENT category than the key, and take ${n - 1} words from that one subcategory.`
        : `2. Pick ONE OTHER subcategory in the SAME category as the key (for example key "tiger" from animal / wild_animal, others from animal / farm_animal), and take ${n - 1} words from that one subcategory.`,
      `3. Check: the ${n - 1} other words all share one subcategory and the key does not. Two words from different subcategories among the others is an error.`,
    ].join('\n');
  if (task === 'semantic_association')
    return [
      `1. Pick the key from KEY WORDS. 2. Put a DIFFERENT word from the key's own subcategory in the stem: Which word goes best with "<word>"? and also set "target": "<word>" on the phase.`,
      unrelated ? `3. Take the ${n - 1} distractors from ${n - 1} different categories, none the key's category.` : `3. Take the ${n - 1} distractors from the key's category but from OTHER subcategories than the key.`,
    ].join('\n');
  return [
    `1. Pick the key from KEY WORDS. 2. Write a short definition of the key (do not use the key word) that does NOT fit any distractor.`,
    dist === 'same_narrow_category' ? `3. Take the ${n - 1} distractors from the key's own subcategory.` : unrelated ? `3. Take the ${n - 1} distractors from other categories.` : `3. Take the ${n - 1} distractors from the key's category but other subcategories.`,
  ].join('\n');
}

export default vocabulary;
