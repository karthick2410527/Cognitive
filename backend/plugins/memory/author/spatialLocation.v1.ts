// Procedural author for spatial_location_recognition: objects appear in grid cells; the probe
// shows one object and asks where it was. Foil cells are chosen so the key is never the
// geometric centre of the option set (the spatial analogue of the context-blind shortcut).
import { ASYMMETRIC_SHAPES, createRng, type AuthorFn, type FillName, type RawItem, type ShapeName } from '@cognimetric/core';
import { cueFor, delayPhase, num, realisation } from './common';

const SHAPES: ShapeName[] = ['circle', 'square', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star', 'cross', ...ASYMMETRIC_SHAPES];
const FILLS: FillName[] = ['solid', 'outline', 'light', 'hatched'];

export const gridFor = (setSize: number): [number, number] => (setSize <= 4 ? [4, 4] : setSize <= 9 ? [5, 5] : [6, 6]);
export const cellXY = (c: number, cols: number) => [c % cols, Math.floor(c / cols)] as const;
export const chebyshev = (a: number, b: number, cols: number) => {
  const [ax, ay] = cellXY(a, cols);
  const [bx, by] = cellXY(b, cols);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
};

/** Spatial foil class by Chebyshev distance: high = adjacent (1); medium = two cells away (2); low = three or more. */
export function spatialClass(key: number, foil: number, cols: number): 'high' | 'medium' | 'low' {
  const d = chebyshev(key, foil, cols);
  return d <= 1 ? 'high' : d === 2 ? 'medium' : 'low';
}

export function keyIsCentral(options: number[], key: number, cols: number): boolean {
  const pts = options.map((c) => cellXY(c, cols));
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const d = pts.map(([x, y]) => Math.hypot(x - cx, y - cy));
  const k = options.indexOf(key);
  const min = Math.min(...d);
  return d[k] === min && d.filter((x) => Math.abs(x - min) < 1e-9).length === 1;
}

/** Share of the options-only centrality vote that lands on the key (0 when it is not among the most central). */
export function centralShare(options: number[], key: number, cols: number): number {
  const pts = options.map((c) => cellXY(c, cols));
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const d = pts.map(([x, y]) => Math.hypot(x - cx, y - cy));
  const min = Math.min(...d);
  const winners = d.filter((x) => Math.abs(x - min) < 1e-9).length;
  return Math.abs(d[options.indexOf(key)]! - min) < 1e-9 ? 1 / winners : 0;
}

const author: AuthorFn = (req) => {
  const root = createRng(req.seed);
  const items: RawItem[] = [];
  for (let n = 0; n < req.count; n++) {
    const rng = root.fork(`item${n}`);
    const L = req.levers;
    const setSize = Math.max(1, Math.round(num(L.set_size, 4)));
    const optionCount = Math.max(2, Math.round(num(L.option_count, 4)));
    const probeCount = Math.min(setSize, Math.max(1, Math.round(num(L.probe_count, 1))));
    const foil = String(L.foil_similarity);
    const [cols, rows] = gridFor(setSize);
    // Place objects so that every probed object has enough foil cells of the requested class.
    const allCells = Array.from({ length: cols * rows }, (_, i) => i);
    const poolFor = (cell: number) => allCells.filter((c) => c !== cell && spatialClass(cell, c, cols) === foil);
    let cells = rng.sample(allCells, setSize);
    for (let tries = 0; tries < 80 && cells.slice(0, probeCount).some((c) => poolFor(c).length < optionCount - 1); tries++) cells = rng.sample(allCells, setSize);
    const shapes = rng.sample(SHAPES, setSize);
    const stimuli = shapes.map((s, i) => ({ asset: `g1:${s}:${rng.pick(FILLS)}:0`, cell: cells[i]! }));
    let conflict: string | null = null;

    const probes: unknown[] = [];
    const key: number[] = [];
    for (const target of rng.shuffle(stimuli.slice(0, probeCount))) {
      const all = Array.from({ length: cols * rows }, (_, i) => i).filter((c) => c !== target.cell);
      const pool = all.filter((c) => spatialClass(target.cell, c, cols) === foil);
      let options: number[] | null = null;
      for (let attempt = 0; attempt < 60 && !options; attempt++) {
        const foils = rng.sample(pool, optionCount - 1);
        if (foils.length < optionCount - 1) break;
        const cand = rng.shuffle([target.cell, ...foils]);
        if (centralShare(cand, target.cell, cols) <= 1 / optionCount + 0.08) options = cand;
      }
      if (!options) {
        conflict = 'foil_similarity';
        options = rng.shuffle([target.cell, ...rng.sample(all, optionCount - 1)]);
      }
      key.push(options.indexOf(target.cell));
      probes.push({ stem: 'Where was this picture?', target_asset: target.asset, options, cue: cueFor(L, stimuli.indexOf(target)) });
    }

    items.push({
      task_type: req.taskType.id,
      blueprint: {
        material: 'spatial',
        phases: [
          {
            phase: 'encode',
            stimuli,
            presentation: {
              exposure_ms: Math.round(num(L.exposure_ms, 5000)),
              inter_stimulus_ms: Math.round(num(L.inter_stimulus_ms, 4000)),
              position_policy: 'grid',
              grid: [cols, rows],
              announce: `You will see ${setSize} picture${setSize === 1 ? '' : 's'} appear one at a time in a grid. Try to remember where each one was.`,
            },
          },
          delayPhase(L),
          { phase: 'retrieve', probes },
        ],
      },
      answer_key: { kind: 'index_per_probe', value: key },
      rationale: 'Each probe keys the only cell where the shown picture appeared during encoding.',
      lever_realisation: realisation(L),
      lever_conflict: conflict,
      content_tags: ['memory', 'recognition', 'spatial'],
      text_alternative: `${setSize} shapes appear one at a time in a ${cols} by ${rows} grid. Afterwards you are shown a shape and choose the square where it appeared.`,
    });
  }
  return items;
};

export default author;
