// Deterministic SVG primitives (Doc 04 §9). Rules: no Math.random, no Date, no fonts —
// every glyph is a path or a geometric primitive; every coordinate is formatted to 2 dp;
// attribute order is fixed by the caller's array order, never by object-key iteration.
import type { FillName, ShapeName, ShapeSpec, Variant } from '../protocol';

export const f = (n: number): string => {
  const r = Math.round(n * 100) / 100;
  return (Object.is(r, -0) ? 0 : r).toFixed(2);
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function el(tag: string, attrs: [string, string | number][], children: string[] = []): string {
  const a = attrs.map(([k, v]) => ` ${k}="${esc(typeof v === 'number' ? f(v) : v)}"`).join('');
  return children.length ? `<${tag}${a}>${children.join('')}</${tag}>` : `<${tag}${a}/>`;
}

export interface Theme {
  ink: string;
  paper: string;
  stroke: number;
  scale: number;
  explicitBackground: boolean;
}

/** default renders in currentColor so the same SVG works in light and dark themes. */
export function themeFor(variant: Variant): Theme {
  switch (variant) {
    case 'high_contrast':
      return { ink: '#000000', paper: '#ffffff', stroke: 4, scale: 1, explicitBackground: true };
    case 'large':
      return { ink: 'currentColor', paper: 'none', stroke: 4, scale: 1.5, explicitBackground: false };
    default:
      return { ink: 'currentColor', paper: 'none', stroke: 3, scale: 1, explicitBackground: false };
  }
}

export function svgRoot(w: number, h: number, theme: Theme, label: string, children: string[], defs: string[] = []): string {
  const W = w * theme.scale;
  const H = h * theme.scale;
  const body: string[] = [];
  if (defs.length) body.push(el('defs', [], defs));
  if (theme.explicitBackground) body.push(el('rect', [['x', 0], ['y', 0], ['width', w], ['height', h], ['fill', theme.paper]]));
  body.push(...children);
  return el(
    'svg',
    [['xmlns', 'http://www.w3.org/2000/svg'], ['viewBox', `0 0 ${f(w)} ${f(h)}`], ['width', W], ['height', H], ['role', 'img'], ['aria-label', label], ['style', `color:${theme.ink === 'currentColor' ? 'inherit' : theme.ink}`]],
    body,
  );
}

// ── Shapes ───────────────────────────────────────────────────────────────────────────
/** Rotational symmetry order; rotation is only visible modulo 360/order. */
export const SHAPE_SYMMETRY: Record<ShapeName, number> = {
  circle: Infinity, square: 4, triangle: 3, diamond: 2, pentagon: 5, hexagon: 6, star: 5, cross: 4,
  arrow: 1, chevron: 1, lshape: 1, semicircle: 1, tshape: 1, flag: 1,
};
export const ASYMMETRIC_SHAPES: ShapeName[] = ['arrow', 'chevron', 'lshape', 'semicircle', 'tshape', 'flag'];

export function visualRot(shape: ShapeName, rot: number): number {
  const order = SHAPE_SYMMETRY[shape];
  if (!Number.isFinite(order)) return 0;
  const period = 360 / order;
  return Math.round((((rot % period) + period) % period) * 100) / 100;
}

type Pt = [number, number];

function regular(n: number, r: number, phase = -90): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const t = ((phase + (360 / n) * i) * Math.PI) / 180;
    return [r * Math.cos(t), r * Math.sin(t)] as Pt;
  });
}

const UNIT: Record<Exclude<ShapeName, 'circle' | 'semicircle'>, Pt[]> = {
  square: regular(4, 1, -45),
  triangle: regular(3, 1.1, -90).map(([x, y]) => [x, y + 0.15] as Pt),
  diamond: [[0, -1], [0.6, 0], [0, 1], [-0.6, 0]],
  pentagon: regular(5, 1),
  hexagon: regular(6, 1, 0),
  star: Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? 0.45 : 1;
    const t = ((-90 + 36 * i) * Math.PI) / 180;
    return [r * Math.cos(t), r * Math.sin(t)] as Pt;
  }),
  cross: [[-0.3, -1], [0.3, -1], [0.3, -0.3], [1, -0.3], [1, 0.3], [0.3, 0.3], [0.3, 1], [-0.3, 1], [-0.3, 0.3], [-1, 0.3], [-1, -0.3], [-0.3, -0.3]],
  arrow: [[-1, -0.25], [0.2, -0.25], [0.2, -0.65], [1, 0], [0.2, 0.65], [0.2, 0.25], [-1, 0.25]],
  chevron: [[-0.8, -0.9], [0.9, 0], [-0.8, 0.9], [-0.8, 0.45], [0.1, 0], [-0.8, -0.45]],
  lshape: [[-0.7, -1], [-0.2, -1], [-0.2, 0.5], [0.7, 0.5], [0.7, 1], [-0.7, 1]],
  tshape: [[-0.9, -1], [0.9, -1], [0.9, -0.5], [0.25, -0.5], [0.25, 1], [-0.25, 1], [-0.25, -0.5], [-0.9, -0.5]],
  flag: [[-0.7, -1], [-0.4, -1], [-0.4, -0.95], [0.8, -0.55], [-0.4, -0.15], [-0.4, 1], [-0.7, 1]],
};

function transform(pts: Pt[], cx: number, cy: number, r: number, rotDeg: number): Pt[] {
  const t = (rotDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return pts.map(([x, y]) => [cx + r * (x * c - y * s), cy + r * (x * s + y * c)] as Pt);
}

const poly = (pts: Pt[]) => pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' ');

export interface PaintCtx { theme: Theme; hatchId: string }

function paintAttrs(fill: FillName, ctx: PaintCtx): [string, string | number][] {
  const { theme } = ctx;
  const sw = theme.stroke;
  switch (fill) {
    case 'solid':
      return [['fill', theme.ink], ['stroke', theme.ink], ['stroke-width', sw], ['stroke-linejoin', 'round']];
    case 'outline':
      return [['fill', theme.paper === 'none' ? 'none' : theme.paper], ['stroke', theme.ink], ['stroke-width', sw], ['stroke-linejoin', 'round']];
    case 'light':
      return [['fill', theme.ink], ['fill-opacity', '0.28'], ['stroke', theme.ink], ['stroke-width', sw], ['stroke-linejoin', 'round']];
    case 'hatched':
      return [['fill', `url(#${ctx.hatchId})`], ['stroke', theme.ink], ['stroke-width', sw], ['stroke-linejoin', 'round']];
  }
}

export function hatchDef(id: string, theme: Theme): string {
  return el('pattern', [['id', id], ['patternUnits', 'userSpaceOnUse'], ['width', 8], ['height', 8], ['patternTransform', 'rotate(45)']], [
    el('line', [['x1', 0], ['y1', 0], ['x2', 0], ['y2', 8], ['stroke', theme.ink], ['stroke-width', Math.max(2, theme.stroke - 1)]]),
  ]);
}

/** One shape centred at (cx, cy) with circumradius r. */
export function shapeEl(spec: { shape: ShapeName; fill: FillName; rot: number }, cx: number, cy: number, r: number, ctx: PaintCtx): string {
  const paint = paintAttrs(spec.fill, ctx);
  if (spec.shape === 'circle') return el('circle', [['cx', cx], ['cy', cy], ['r', r], ...paint]);
  if (spec.shape === 'semicircle') {
    const t = (spec.rot * Math.PI) / 180;
    const [ax, ay] = [cx + r * Math.cos(t + Math.PI / 2), cy + r * Math.sin(t + Math.PI / 2)];
    const [bx, by] = [cx + r * Math.cos(t - Math.PI / 2), cy + r * Math.sin(t - Math.PI / 2)];
    const d = `M${f(ax)} ${f(ay)} A${f(r)} ${f(r)} 0 0 1 ${f(bx)} ${f(by)} Z`;
    return el('path', [['d', d], ...paint]);
  }
  return el('polygon', [['points', poly(transform(UNIT[spec.shape], cx, cy, r, spec.rot))], ...paint]);
}

export const SIZE_FACTOR: Record<'s' | 'm' | 'l', number> = { s: 0.45, m: 0.65, l: 0.85 };

/** A cell containing `count` copies of a shape laid out side by side (perceptual organisation: separation). */
export function cellEl(spec: ShapeSpec & { count?: number }, x: number, y: number, w: number, h: number, ctx: PaintCtx): string {
  const count = spec.count ?? 1;
  const inner = Math.min(w, h);
  const layouts: Record<number, Pt[]> = {
    1: [[0.5, 0.5]],
    2: [[0.28, 0.5], [0.72, 0.5]],
    3: [[0.5, 0.27], [0.27, 0.72], [0.73, 0.72]],
    4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  };
  const pts = layouts[count] ?? layouts[1]!;
  const slot = count === 1 ? inner : inner / 2.1;
  const r = (slot / 2) * SIZE_FACTOR[spec.size];
  return el('g', [], pts.map(([px, py]) => shapeEl(spec, x + px * w, y + py * h, r, ctx)));
}

// ── Seven-segment digits: numerals without fonts ───────────────────────────────────────
const SEGMENTS: Record<number, string> = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };

export function digitEl(value: number, cx: number, cy: number, height: number, theme: Theme): string {
  const h = height;
  const w = h * 0.55;
  const t = h * 0.11;
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  const seg: Record<string, [number, number, number, number]> = {
    a: [x0 + t, y0, w - 2 * t, t],
    g: [x0 + t, y0 + h / 2 - t / 2, w - 2 * t, t],
    d: [x0 + t, y0 + h - t, w - 2 * t, t],
    f: [x0, y0 + t, t, h / 2 - 1.5 * t],
    b: [x0 + w - t, y0 + t, t, h / 2 - 1.5 * t],
    e: [x0, y0 + h / 2 + t / 2, t, h / 2 - 1.5 * t],
    c: [x0 + w - t, y0 + h / 2 + t / 2, t, h / 2 - 1.5 * t],
  };
  const on = SEGMENTS[value] ?? '';
  return el('g', [], on.split('').map((s) => {
    const [x, y, ww, hh] = seg[s]!;
    return el('rect', [['x', x], ['y', y], ['width', ww], ['height', hh], ['rx', t / 3], ['fill', theme.ink]]);
  }));
}

// ── Arrows for flanker / spatial-Stroop rows ─────────────────────────────────────────
export function arrowGlyph(dir: 'L' | 'R' | 'N', cx: number, cy: number, size: number, theme: Theme): string {
  if (dir === 'N') return el('rect', [['x', cx - size * 0.45], ['y', cy - size * 0.08], ['width', size * 0.9], ['height', size * 0.16], ['fill', theme.ink]]);
  const pts = transform(UNIT.arrow, cx, cy, size * 0.5, dir === 'R' ? 0 : 180);
  return el('polygon', [['points', poly(pts)], ['fill', theme.ink]]);
}

// ── Symbol glyphs for substitution blocks, built from strokes on a 3×3 lattice ───────
type Stroke = [number, number, number, number]; // lattice coords 0..2
const HIGH: Stroke[][] = [
  [[0, 0, 2, 2], [2, 0, 0, 2]],
  [[1, 0, 1, 2], [0, 1, 2, 1]],
  [[0, 2, 1, 0], [1, 0, 2, 2], [0, 2, 2, 2]],
  [[0, 0, 2, 0], [2, 0, 2, 2], [2, 2, 0, 2], [0, 2, 0, 0]],
  [[0, 0, 0, 2], [0, 2, 2, 2]],
  [[0, 0, 1, 1], [1, 1, 2, 0], [1, 1, 1, 2]],
  [[0, 1, 1, 0], [1, 0, 2, 1], [2, 1, 1, 2], [1, 2, 0, 1]],
  [[0, 0, 2, 0], [1, 0, 1, 2]],
  [[0, 2, 1, 1], [1, 1, 2, 2], [0, 0, 2, 0]],
];
const MEDIUM_BASE: Stroke[] = [[0, 0, 2, 0], [0, 0, 0, 2]];
const MEDIUM_EXTRA: Stroke[] = [[2, 0, 2, 2], [0, 2, 2, 2], [0, 0, 2, 2], [1, 0, 1, 2], [0, 1, 2, 1], [2, 0, 0, 2], [1, 1, 2, 2], [0, 2, 1, 1], [1, 0, 2, 1]];
const LOW_BASE: Stroke[] = [[0, 0, 0, 2], [0, 0, 2, 0], [0, 1, 1, 1]];

function d4(s: Stroke, k: number): Stroke {
  const map = (x: number, y: number): [number, number] => {
    let [a, b] = [x - 1, y - 1];
    for (let i = 0; i < (k & 3); i++) [a, b] = [-b, a];
    if (k & 4) a = -a;
    return [a + 1, b + 1];
  };
  const [x1, y1] = map(s[0], s[1]);
  const [x2, y2] = map(s[2], s[3]);
  return [x1, y1, x2, y2];
}

export const SYMBOL_SETS: Record<string, Stroke[][]> = {
  high: HIGH,
  medium: MEDIUM_EXTRA.map((e) => [...MEDIUM_BASE, e]),
  low: [...Array.from({ length: 8 }, (_, k) => LOW_BASE.map((s) => d4(s, k))), [...LOW_BASE, [1, 1, 2, 2]]],
};

export function symbolEl(set: string, id: number, cx: number, cy: number, size: number, theme: Theme): string {
  const strokes = SYMBOL_SETS[set]?.[id] ?? SYMBOL_SETS.high![0]!;
  const step = size / 2;
  const x0 = cx - size / 2;
  const y0 = cy - size / 2;
  return el('g', [], strokes.map(([a, b, c, d]) =>
    el('line', [['x1', x0 + a * step], ['y1', y0 + b * step], ['x2', x0 + c * step], ['y2', y0 + d * step], ['stroke', theme.ink], ['stroke-width', Math.max(3, size * 0.09)], ['stroke-linecap', 'round']]),
  ));
}
