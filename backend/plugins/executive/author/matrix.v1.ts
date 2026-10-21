// Procedural author for matrix_completion: emits puzzle structure + a rule from the closed
// taxonomy (Doc 04 §3–4), exactly as the LLM is asked to. It proposes its own (naive, single-
// attribute) options; the engine discards them and regenerates distractors with fair_tree.
import {
  ASYMMETRIC_SHAPES, createRng, solveMatrix,
  type Attr, type AuthorFn, type FillName, type MatrixCell, type MatrixPuzzle, type MatrixRule, type RawItem, type Relation, type Rng, type ShapeName, type SizeName,
} from '@cognimetric/core';

const SYMMETRIC: ShapeName[] = ['circle', 'square', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star', 'cross'];
const FILLS: FillName[] = ['solid', 'outline', 'light', 'hatched'];
const SIZES: SizeName[] = ['s', 'm', 'l'];
const ROTS = [0, 45, 90, 135, 180, 225, 270, 315];
const num = (v: unknown, d: number) => (typeof v === 'number' ? v : Number(v ?? d));

type LineGen = (lineIdx: number) => unknown[];

function chooseOps(rng: Rng, attrs: Attr[], elementCount: number, binary: boolean, ruleCount: number): { attr: Attr; op: Relation['op']; params: Record<string, unknown> }[] {
  const out: { attr: Attr; op: Relation['op']; params: Record<string, unknown> }[] = [];
  for (const a of attrs) {
    if (a === 'count') {
      if (binary && elementCount >= 3) out.push({ attr: a, op: 'arithmetic', params: { sign: '+' } });
      else if (elementCount >= 3) out.push(rng.chance(0.5) ? { attr: a, op: 'progression', params: { step: 1 } } : { attr: a, op: 'distribution_of_three', params: { values: [1, 2, 3] } });
      else out.push({ attr: a, op: 'constant', params: {} });
    } else if (a === 'rot') {
      out.push(rng.chance(0.6) ? { attr: a, op: 'progression', params: { step: rng.pick([45, 90]) } } : { attr: a, op: 'distribution_of_three', params: { values: rng.sample([0, 90, 180, 270], 3) } });
    } else if (a === 'size') {
      out.push(rng.chance(0.5) ? { attr: a, op: 'size_series', params: {} } : { attr: a, op: 'distribution_of_three', params: { values: SIZES } });
    } else {
      const pool = a === 'shape' ? [] : FILLS;
      out.push(ruleCount === 1 || rng.chance(0.75) ? { attr: a, op: 'distribution_of_three', params: { values: a === 'fill' ? rng.sample(pool, 3) : [] } } : { attr: a, op: 'constant', params: {} });
    }
  }
  return out;
}

function makePuzzle(rng: Rng, L: Record<string, unknown>): { puzzle: MatrixPuzzle; rule: MatrixRule; key: MatrixCell } {
  const ruleCount = Math.round(num(L.rule_count, 2));
  const elementCount = Math.round(num(L.element_count, 1));
  const binary = L.relation_arity_max === 'binary';
  const distractN = Math.round(num(L.distracting_attributes, 0));
  const direction = String(L.analogical_direction ?? 'row');

  // Attributes for rules. Count can only carry a rule when cells may hold several elements.
  let candidates: Attr[] = ['shape', 'fill', 'size', 'rot', ...(elementCount >= 2 ? (['count'] as Attr[]) : [])];
  const ruled: Attr[] = [];
  if (binary && elementCount >= 3 && ruleCount >= 2) ruled.push('count');
  for (const a of rng.shuffle(candidates)) if (ruled.length < ruleCount && !ruled.includes(a)) ruled.push(a);
  candidates = candidates.filter((a) => !ruled.includes(a));
  const distracting = rng.sample(candidates.filter((a) => a !== 'count' || elementCount >= 2), distractN);
  const rotVisible = ruled.includes('rot') || distracting.includes('rot');
  const shapePool = rotVisible ? ASYMMETRIC_SHAPES : [...SYMMETRIC, ...ASYMMETRIC_SHAPES];

  const ops = chooseOps(rng, ruled, elementCount, binary, ruleCount);
  for (const o of ops) if (o.attr === 'shape' && o.op === 'distribution_of_three') o.params.values = rng.sample(shapePool, 3);

  const relations: Relation[] = ops.map((o, i) => ({
    id: `r${i + 1}`,
    arity: o.op === 'arithmetic' ? 'binary' : 'unary',
    attribute: o.attr,
    op: o.op,
    axis: direction === 'column' ? 'column' : direction === 'both' ? (i % 2 ? 'column' : 'row') : 'row',
    params: o.params,
  }));

  // Line generators per relation.
  const shifts = rng.shuffle([0, 1, 2]);
  const arithRows = rng.shuffle([[1, 1, 2], [1, 2, 3], [2, 1, 3]]);
  const gens = new Map<Attr, { rel: Relation; gen: LineGen }>();
  for (const rel of relations) {
    let gen: LineGen;
    switch (rel.op) {
      case 'constant': {
        const pool: unknown[] = rel.attribute === 'shape' ? shapePool : rel.attribute === 'fill' ? FILLS : rel.attribute === 'size' ? SIZES : rel.attribute === 'rot' ? [0, 90, 180] : [1, 2];
        const vals = rng.sample(pool, 3);
        gen = (i) => [vals[i % vals.length], vals[i % vals.length], vals[i % vals.length]];
        break;
      }
      case 'progression': {
        const step = Number(rel.params.step);
        if (rel.attribute === 'rot') {
          const starts = rng.sample(ROTS, 3);
          gen = (i) => [0, 1, 2].map((k) => (starts[i]! + step * k) % 360);
        } else gen = () => [1, 2, 3];
        break;
      }
      case 'size_series':
        gen = () => ['s', 'm', 'l'];
        break;
      case 'distribution_of_three': {
        const values = rel.params.values as unknown[];
        gen = (i) => [0, 1, 2].map((k) => values[(k + shifts[i]!) % 3]);
        break;
      }
      case 'arithmetic':
        gen = (i) => arithRows[i]!;
        break;
    }
    gens.set(rel.attribute, { rel, gen });
  }

  const globals: Partial<MatrixCell> = {
    shape: rng.pick(shapePool), fill: rng.pick(FILLS), size: rng.pick(['m', 'l'] as SizeName[]), rot: 0, count: 1,
  };
  const cells: MatrixCell[][] = [0, 1, 2].map((i) => [0, 1, 2].map((j) => {
    const c: Record<string, unknown> = {};
    for (const a of ['shape', 'fill', 'size', 'rot', 'count'] as Attr[]) {
      const g = gens.get(a);
      if (g) c[a] = g.rel.axis === 'row' ? g.gen(i)[j] : g.gen(j)[i];
      else if (distracting.includes(a)) c[a] = a === 'shape' ? rng.pick(shapePool) : a === 'fill' ? rng.pick(FILLS) : a === 'size' ? rng.pick(SIZES) : a === 'rot' ? rng.pick([0, 90, 180, 270]) : 1 + rng.int(Math.min(3, elementCount));
      else c[a] = globals[a];
    }
    return c as unknown as MatrixCell;
  }));
  const key = cells[2]![2]!;
  const gridCells: (MatrixCell | null)[][] = cells.map((row, i) => row.map((c, j) => (i === 2 && j === 2 ? null : c)));
  const maxCount = Math.max(...cells.flat().map((c) => c.count), elementCount);
  const puzzle: MatrixPuzzle = {
    family: 'matrix',
    canvas: { w: 480, h: 480, cells: [3, 3] },
    alphabet: { shapes: [...new Set([...cells.flat().map((c) => c.shape), ...rng.sample(shapePool, 2)])], fills: FILLS, sizes: SIZES, rotations: rotVisible ? ROTS : [0], counts: Array.from({ length: Math.max(2, Math.min(3, maxCount)) }, (_, k) => k + 1), colours: ['ink'] },
    cells: gridCells,
    perceptual_organisation: 'separation',
    distracting_attributes: distracting,
  };
  const rule: MatrixRule = { relations, solution_cell: [2, 2], deterministic: true, unique_solution_required: true };
  return { puzzle, rule, key };
}

const author: AuthorFn = (req) => {
  const root = createRng(req.seed);
  const out: RawItem[] = [];
  for (let n = 0; n < req.count; n++) {
    const rng = root.fork(`item${n}`);
    let built = makePuzzle(rng, req.levers);
    for (let attempt = 0; attempt < 8; attempt++) {
      const probe = solveMatrix({ puzzle: built.puzzle, rule: built.rule, options: [built.key], keyIndex: 0 });
      if (probe.verdict === 'key_confirmed') break;
      built = makePuzzle(rng, req.levers);
    }
    const { puzzle, rule, key } = built;
    // Naive model-style options: single-attribute edits of the key (kept only in provenance).
    const optionCount = Math.round(num(req.levers.option_count, 5));
    const naive: MatrixCell[] = [key];
    // A careful model edits only rule-bearing attributes (editing a distracting one would make a second correct option).
    const attrs: Attr[] = (['shape', 'fill', 'size', 'count', 'rot'] as Attr[]).filter((a) => !puzzle.distracting_attributes.includes(a) && (a !== 'rot' || puzzle.alphabet.rotations.length > 1));
    for (let guard = 0; naive.length < optionCount && guard < 60; guard++) {
      const a = rng.pick(attrs);
      const pool: unknown[] = a === 'shape' ? puzzle.alphabet.shapes : a === 'fill' ? FILLS : a === 'size' ? SIZES : a === 'rot' ? puzzle.alphabet.rotations : puzzle.alphabet.counts;
      const v = rng.pick(pool);
      const c = { ...key, [a]: v } as MatrixCell;
      if (!naive.some((x) => JSON.stringify(x) === JSON.stringify(c))) naive.push(c);
    }
    const order = rng.shuffle(naive.map((_, i) => i));
    out.push({
      task_type: req.taskType.id,
      blueprint: {
        phases: [{ phase: 'present', stem: 'Which option completes the pattern?' }],
        puzzle: puzzle as unknown as Record<string, unknown>,
        rule: rule as unknown as Record<string, unknown>,
        options: { count: optionCount, generation_policy: 'fair_tree', items: order.map((i) => naive[i]!) },
      },
      answer_key: { kind: 'index', value: order.indexOf(0) },
      rationale: `Applying ${rule.relations.map((r) => `${r.op} on ${r.attribute} by ${r.axis}`).join('; ')} to the last line determines the missing cell uniquely.`,
      lever_realisation: { ...req.levers, rule_count: rule.relations.length, distracting_attributes: puzzle.distracting_attributes.length },
      lever_conflict: rule.relations.length !== Math.round(num(req.levers.rule_count, 2)) ? 'rule_count' : null,
      content_tags: ['executive', 'reasoning', 'matrix'],
      text_alternative: `A three by three grid of figures with the bottom-right figure missing. The figures change across rows and columns following ${rule.relations.length} rule${rule.relations.length === 1 ? '' : 's'}.`,
    });
  }
  return out;
};

export default author;
