// DOM renderer for written attention questions. Codes and letter lines are shown in a monospaced
// face so every character has the same width and none can hide in proportional spacing.
import type { RendererFn } from '@cognimetric/core';

const render: RendererFn = ({ item }) => {
  const p = item.blueprint.phases[0] as { stem?: string; options?: string[]; instruction_text?: string; display?: string };
  return { payload: { stem: p.stem ?? '', instruction: p.instruction_text ?? null, options: p.options ?? [], display: p.display ?? null, display_style: 'mono' } };
};

export default render;
