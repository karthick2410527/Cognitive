// Options-only surface-form solver: if length, syllables, initial letter or frequency alone pick
// the key, the options leak it (Doc 08 §8).
import { surfaceOddness, type ContextBlindFn } from '@cognimetric/core';

const contextBlind: ContextBlindFn = ({ item, services }) => {
  const opts = (item.blueprint.phases[0]?.options ?? []).map(String);
  const per = surfaceOddness(opts, (w) => services.lexicon?.lookup(w)?.zipf ?? 0);
  return { per_question: [per], key_indices: [item.answer_key.kind === 'index' ? item.answer_key.value : -1] };
};

export default contextBlind;
