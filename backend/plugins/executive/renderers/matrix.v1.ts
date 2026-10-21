// Matrix renderer: stem grid plus separately rendered 120×120 options. Text (stem, labels) is DOM.
import { renderMatrix, renderMatrixOption, type MatrixCell, type MatrixPuzzle, type RendererFn } from '@cognimetric/core';

const render: RendererFn = ({ item, variant, idPrefix }) => {
  const bp = item.blueprint as unknown as { puzzle: MatrixPuzzle; options: { items: MatrixCell[] }; phases: { stem?: string }[] };
  return {
    payload: {
      stem: bp.phases[0]?.stem ?? 'Which option completes the pattern?',
      figure_svg: renderMatrix(bp.puzzle, variant, `${idPrefix}-m`),
      options: bp.options.items.map((c, i) => renderMatrixOption(c, variant, `${idPrefix}-o${i}`)),
      text_alternative: item.text_alternative ?? null,
    },
  };
};

export default render;
