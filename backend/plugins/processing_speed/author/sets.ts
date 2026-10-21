import type { ShapeName } from '@cognimetric/core';

/** Shape sets by measured discriminability tier (choice RT). */
export const SHAPE_TIERS: Record<string, ShapeName[]> = {
  high: ['circle', 'square', 'triangle', 'cross', 'star'],
  medium: ['pentagon', 'hexagon', 'circle', 'diamond', 'square'],
  low: ['pentagon', 'hexagon', 'circle', 'star'],
};
