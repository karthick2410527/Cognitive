// Pure renderers: (blueprint fragment, variant, idPrefix) → SVG string. Shared by the backend
// validator / bank renderer and the frontend trial renderer, so what is solved is what is seen.
import type { ShapeSpec, Stimulus, Variant } from '../protocol';
import type { MatrixCell, MatrixPuzzle } from '../puzzle/matrix';
import { arrowGlyph, cellEl, digitEl, el, hatchDef, shapeEl, svgRoot, symbolEl, themeFor } from './primitives';
import type { PaintCtx } from './primitives';

const ctxFor = (variant: Variant, idPrefix: string): PaintCtx => ({ theme: themeFor(variant), hatchId: `${idPrefix}-hatch` });

function uses(cells: (MatrixCell | ShapeSpec | null)[]): boolean {
  return cells.some((c) => c?.fill === 'hatched');
}

/** Matrix stem: grid with 8 % gutters, the answer slot as a dashed outline (Doc 04 §9). */
export function renderMatrix(p: MatrixPuzzle, variant: Variant, idPrefix: string): string {
  const ctx = ctxFor(variant, idPrefix);
  const W = p.canvas.w;
  const H = p.canvas.h;
  const [rows, cols] = [p.cells.length, p.cells[0]!.length];
  const gx = W * 0.08 / (cols + 1);
  const gy = H * 0.08 / (rows + 1);
  const cw = (W - gx * (cols + 1)) / cols;
  const ch = (H - gy * (rows + 1)) / rows;
  const kids: string[] = [];
  p.cells.forEach((row, i) => row.forEach((c, j) => {
    const x = gx + j * (cw + gx);
    const y = gy + i * (ch + gy);
    if (c) {
      kids.push(el('rect', [['x', x], ['y', y], ['width', cw], ['height', ch], ['rx', 6], ['fill', 'none'], ['stroke', ctx.theme.ink], ['stroke-opacity', '0.35'], ['stroke-width', 1.5]]));
      kids.push(cellEl(c, x + cw * 0.08, y + ch * 0.08, cw * 0.84, ch * 0.84, ctx));
    } else {
      kids.push(el('rect', [['x', x], ['y', y], ['width', cw], ['height', ch], ['rx', 6], ['fill', 'none'], ['stroke', ctx.theme.ink], ['stroke-width', 2.5], ['stroke-dasharray', '10 8'], ['aria-label', 'missing piece']]));
    }
  }));
  const defs = uses(p.cells.flat()) ? [hatchDef(ctx.hatchId, ctx.theme)] : [];
  return svgRoot(W, H, ctx.theme, `Pattern grid of ${rows} by ${cols} with one missing piece`, kids, defs);
}

/** Options are separate 120×120 SVGs so order can be shuffled per administration. */
export function renderMatrixOption(c: MatrixCell, variant: Variant, idPrefix: string): string {
  const ctx = ctxFor(variant, idPrefix);
  return svgRoot(120, 120, ctx.theme, 'answer option', [cellEl(c, 10, 10, 100, 100, ctx)], c.fill === 'hatched' ? [hatchDef(ctx.hatchId, ctx.theme)] : []);
}

/** A single stimulus object (memory object recognition, naming pictures). */
export function renderObject(spec: ShapeSpec, variant: Variant, idPrefix: string, size = 160): string {
  const ctx = ctxFor(variant, idPrefix);
  return svgRoot(size, size, ctx.theme, 'picture', [cellEl(spec, size * 0.06, size * 0.06, size * 0.88, size * 0.88, ctx)], spec.fill === 'hatched' ? [hatchDef(ctx.hatchId, ctx.theme)] : []);
}

/** Spatial grid: either shows an object at a cell, or highlights a cell (probe option). */
export function renderSpatialGrid(cols: number, rows: number, placed: { index: number; spec: ShapeSpec } | null, highlight: number | null, variant: Variant, idPrefix: string, size = 240): string {
  const ctx = ctxFor(variant, idPrefix);
  const cw = size / cols;
  const ch = size / rows;
  const kids: string[] = [];
  for (let i = 0; i < cols * rows; i++) {
    const x = (i % cols) * cw;
    const y = Math.floor(i / cols) * ch;
    const hl = highlight === i;
    kids.push(el('rect', [['x', x + 2], ['y', y + 2], ['width', cw - 4], ['height', ch - 4], ['rx', 4], ['fill', hl ? ctx.theme.ink : 'none'], ['fill-opacity', hl ? '0.85' : '1'], ['stroke', ctx.theme.ink], ['stroke-opacity', hl ? '1' : '0.4'], ['stroke-width', hl ? 3 : 1.5]]));
    if (placed && placed.index === i) kids.push(cellEl(placed.spec, x + cw * 0.12, y + ch * 0.12, cw * 0.76, ch * 0.76, ctx));
  }
  const defs = placed?.spec.fill === 'hatched' ? [hatchDef(ctx.hatchId, ctx.theme)] : [];
  return svgRoot(size, size, ctx.theme, highlight !== null ? `grid with square ${highlight + 1} marked` : 'grid', kids, defs);
}

// ── Generic trial stimuli for timed blocks ───────────────────────────────────────────
function stimulusKids(s: Stimulus, cx: number, cy: number, size: number, ctx: PaintCtx, defs: Set<string>): string[] {
  const t = ctx.theme;
  switch (s.kind) {
    case 'blank':
      return [];
    case 'fixation':
      return [
        el('rect', [['x', cx - size * 0.08], ['y', cy - 1.5], ['width', size * 0.16], ['height', 3], ['fill', t.ink]]),
        el('rect', [['x', cx - 1.5], ['y', cy - size * 0.08], ['width', 3], ['height', size * 0.16], ['fill', t.ink]]),
      ];
    case 'digit':
      return [digitEl(s.value, cx, cy, size * 0.55 * (s.scale ?? 1), t)];
    case 'shape':
      if (s.spec.fill === 'hatched') defs.add('hatch');
      return [shapeEl(s.spec, cx, cy, (size / 2) * 0.7 * ({ s: 0.6, m: 0.8, l: 1 } as const)[s.spec.size], ctx)];
    case 'arrows': {
      const n = s.dirs.length;
      const gap = size / Math.max(n, 5);
      return s.dirs.map((d, i) => arrowGlyph(d, cx + (i - (n - 1) / 2) * gap, cy, gap * 0.8, t));
    }
    case 'positioned':
      return stimulusKids(s.child, cx + s.x * size * 0.32, cy + s.y * size * 0.32, size * 0.45, ctx, defs);
    case 'grid': {
      const cell = (size * 0.9) / Math.max(s.cols, s.rows);
      const x0 = cx - (cell * s.cols) / 2;
      const y0 = cy - (cell * s.rows) / 2;
      const out: string[] = [];
      s.cells.forEach((c, i) => {
        if (!c) return;
        if (c.fill === 'hatched') defs.add('hatch');
        out.push(shapeEl(c, x0 + (i % s.cols) * cell + cell / 2, y0 + Math.floor(i / s.cols) * cell + cell / 2, cell * 0.36, ctx));
      });
      return out;
    }
    case 'pair':
      return [...stimulusKids(s.left, cx - size * 0.22, cy, size * 0.42, ctx, defs), ...stimulusKids(s.right, cx + size * 0.22, cy, size * 0.42, ctx, defs)];
    case 'symbol':
      return [symbolEl(s.set, s.id, cx, cy, size * 0.42, t)];
    case 'symbol_key': {
      const n = s.pairs.length;
      const cellW = size / n;
      return s.pairs.flatMap((p, i) => {
        const x = cx - size / 2 + cellW * (i + 0.5);
        return [
          el('rect', [['x', x - cellW / 2 + 2], ['y', cy - cellW * 0.95], ['width', cellW - 4], ['height', cellW * 1.9], ['rx', 4], ['fill', 'none'], ['stroke', t.ink], ['stroke-opacity', '0.4'], ['stroke-width', 1.5]]),
          symbolEl(s.set, p.symbol, x, cy - cellW * 0.45, cellW * 0.5, t),
          digitEl(p.digit, x, cy + cellW * 0.48, cellW * 0.55, t),
        ];
      });
    }
    case 'symbol_row': {
      const n = s.ids.length;
      const cellW = size / n;
      return s.ids.flatMap((id, i) => {
        const x = cx - size / 2 + cellW * (i + 0.5);
        const box = i === s.highlight
          ? [el('rect', [['x', x - cellW / 2 + 2], ['y', cy - cellW * 0.5], ['width', cellW - 4], ['height', cellW], ['rx', 4], ['fill', 'none'], ['stroke', t.ink], ['stroke-width', 3]])]
          : [];
        return [...box, el('g', [['opacity', i === s.highlight ? '1' : i < s.highlight ? '0.25' : '0.55']], [symbolEl(s.set, id, x, cy, cellW * 0.55, t)])];
      });
    }
    case 'cue':
      return [el('rect', [['x', cx - size * 0.46], ['y', cy - size * 0.46], ['width', size * 0.92], ['height', size * 0.92], ['rx', 10], ['fill', 'none'], ['stroke', t.ink], ['stroke-width', 5], ...(s.style === 'border_dashed' ? [['stroke-dasharray', '14 10'] as [string, string]] : [])])];
    case 'with_cue':
      return [...stimulusKids({ kind: 'cue', style: s.cue }, cx, cy, size, ctx, defs), ...stimulusKids(s.child, cx, cy, size * 0.8, ctx, defs)];
  }
}

export function renderStimulus(s: Stimulus, variant: Variant, idPrefix: string, w = 400, h = 400): string {
  const ctx = ctxFor(variant, idPrefix);
  const defs = new Set<string>();
  const kids = stimulusKids(s, w / 2, h / 2, s.kind === 'symbol_key' || s.kind === 'symbol_row' ? w : Math.min(w, h), ctx, defs);
  return svgRoot(w, h, ctx.theme, 'stimulus', kids, defs.has('hatch') ? [hatchDef(ctx.hatchId, ctx.theme)] : []);
}

/** Rough render-cost estimate (node count) for the authoring-time frame-budget check (Doc 04 §11). */
export function renderCost(svg: string): { nodes: number; bytes: number } {
  return { nodes: (svg.match(/</g) ?? []).length, bytes: svg.length };
}
