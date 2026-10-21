// Prompt vocabulary for word recognition: common, concrete words (so the item measures memory, not
// vocabulary), grouped by category / subcategory so foil similarity can be realised and checked.
import type { VocabularyFn } from '@cognimetric/core';

const vocabulary: VocabularyFn = ({ services }) => {
  const lex = services.lexicon;
  if (!lex) return null;
  const groups = new Map<string, string[]>();
  for (const e of lex.all().filter((x) => x.zipf >= 3.2)) groups.set(`${e.category} / ${e.subcategory}`, [...(groups.get(`${e.category} / ${e.subcategory}`) ?? []), e.word]);
  return [
    'ALLOWED VOCABULARY — encoded words and foils must come from this list (category / subcategory: words).',
    'Encode at most one word per subcategory. Foil similarity: high = same subcategory as the target; medium = same category, other subcategory; low = another category.',
    ...[...groups.entries()].map(([k, ws]) => `${k}: ${ws.join(', ')}`),
  ].join('\n');
};

export default vocabulary;
