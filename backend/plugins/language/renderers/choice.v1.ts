// DOM renderer for single-screen verbal choice items.
import type { RendererFn } from '@cognimetric/core';

const render: RendererFn = ({ item }) => {
  const p = item.blueprint.phases[0] as { stem?: string; options?: string[]; instruction_text?: string };
  return { payload: { stem: p.stem ?? '', instruction: p.instruction_text ?? null, options: p.options ?? [] } };
};

export default render;
