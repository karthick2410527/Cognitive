// Matrix normalisation (engine-owned fields only): canvas, the closed alphabet, and an empty
// distracting-attributes list written as 0. The cells, the rule and the key are never changed.
import { ASYMMETRIC_SHAPES, type NormalizerFn } from '@cognimetric/core';

const ALL_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star', 'cross', ...ASYMMETRIC_SHAPES];

const normalize: NormalizerFn = ({ raw, levers }) => {
  const bp = raw.blueprint as Record<string, any> | undefined;
  const p = bp?.puzzle as Record<string, any> | undefined;
  if (!p || !Array.isArray(p.cells)) return raw;
  if (!Array.isArray(p.distracting_attributes) && (p.distracting_attributes === 0 || p.distracting_attributes == null) && Number(levers.distracting_attributes ?? 0) === 0) p.distracting_attributes = [];
  p.family ??= 'matrix';
  p.perceptual_organisation ??= 'separation';
  p.canvas = { w: 480, h: 480, cells: [p.cells.length, p.cells[0]?.length ?? 3] };
  const cells = (p.cells as unknown[][]).flat().filter(Boolean) as Record<string, unknown>[];
  const used = (k: string) => [...new Set(cells.map((c) => c[k]))];
  const rots = used('rot').map(Number);
  const a = (p.alphabet ?? {}) as Record<string, unknown[]>;
  p.alphabet = {
    shapes: [...new Set([...(a.shapes ?? []), ...used('shape')])].filter((s) => ALL_SHAPES.includes(String(s))),
    fills: ['solid', 'outline', 'light', 'hatched'],
    sizes: ['s', 'm', 'l'],
    rotations: rots.some((r) => r % 360 !== 0) ? [0, 45, 90, 135, 180, 225, 270, 315] : [0],
    counts: [1, 2, 3],
    colours: ['ink'],
  };
  if (Array.isArray((p.alphabet as { shapes: unknown[] }).shapes) && (p.alphabet as { shapes: unknown[] }).shapes.length < 3)
    (p.alphabet as { shapes: string[] }).shapes.push(...ALL_SHAPES.filter((s) => !(p.alphabet as { shapes: string[] }).shapes.includes(s)).slice(0, 2));
  return raw;
};

export default normalize;
