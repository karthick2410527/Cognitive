// Options-only solver (centrality + attribute-frequency vote, Doc 04 §6.2).
import { contextBlindMatrix, type ContextBlindFn, type MatrixCell } from '@cognimetric/core';

const contextBlind: ContextBlindFn = ({ item }) => {
  const opts = ((item.blueprint as Record<string, unknown>).options as { items: MatrixCell[] }).items;
  return { per_question: [contextBlindMatrix(opts)], key_indices: [item.answer_key.kind === 'index' ? item.answer_key.value : -1] };
};

export default contextBlind;
