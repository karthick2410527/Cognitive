// DOM renderer for free-form written questions: the question, its options, and the format name the
// writer gave it (shown in the question card's header).
import type { RendererFn } from '@cognimetric/core';

const render: RendererFn = ({ item }) => {
  const p = item.blueprint.phases[0] as { stem?: string; options?: string[]; format?: string };
  return { payload: { stem: p.stem ?? '', instruction: null, options: p.options ?? [], task_label: p.format ? p.format.replace(/_/g, ' ') : null } };
};

export default render;
