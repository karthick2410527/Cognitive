// Prompt vocabulary for asset-driven memory items: the glyph-pack-v1 asset ids and the registry's
// similarity relation, so the model can realise foil_similarity exactly as the solver checks it.
import { ASYMMETRIC_SHAPES, type VocabularyFn } from '@cognimetric/core';

const vocabulary: VocabularyFn = ({ levers, taskType }) => {
  const sym = ['circle', 'square', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star', 'cross'];
  const lines = [
    'ASSETS — glyph-pack-v1. An asset id is g1:<shape>:<fill>:<rotation>.',
    `Orientable shapes (rotation 0, 90, 180 or 270): ${ASYMMETRIC_SHAPES.join(', ')}.`,
    `Symmetric shapes (rotation always 0): ${sym.join(', ')}.`,
    'Fills, in order: solid, outline, light, hatched.',
    'Encode each shape at most once per item.',
  ];
  if (taskType.id === 'image_recognition_forced_choice') {
    lines.push(
      'FOIL SIMILARITY, exactly as the solver checks it (compare each foil with the target):',
      '  high   = same shape, same fill, different rotation (orientable shapes only), or a fill one step away with the same rotation.',
      '  medium = same shape with BOTH fill and rotation different, or (symmetric shapes) a fill two or more steps away.',
      '  low    = a different shape that was not encoded.',
      `Requested foil_similarity: ${String(levers.foil_similarity)}. Use orientable shapes for probe targets when it is high or medium. Every foil must be in that class and must not be an encoded asset.`,
    );
  } else {
    lines.push('Stimuli are { "asset": id, "cell": index } on the grid; options are cell indexes. high = foils in cells adjacent to the target cell; medium = exactly two cells away; low = three or more away.');
  }
  return lines.join('\n');
};

export default vocabulary;
