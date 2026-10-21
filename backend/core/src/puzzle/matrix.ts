// Visual puzzle engine (Doc 04): closed rule taxonomy, independent solver, fair-tree
// distractors, context-blind solver, canonicalisation. The engine owns all of this; the
// LLM only proposes a structure and a rule.
import type { FillName, ShapeName, SizeName } from '../protocol';
import type { Rng } from '../prng';
import { canonicalJson } from '../canonical';
import { visualRot } from '../svg/primitives';

export const ATTRS = ['shape', 'fill', 'size', 'rot', 'count'] as const;
export type Attr = (typeof ATTRS)[number];
export const OPS = ['constant', 'progression', 'distribution_of_three', 'arithmetic', 'size_series'] as const;
export type Op = (typeof OPS)[number];
export const OP_ARITY: Record<Op, 'unary' | 'binary' | 'ternary'> = {
  constant: 'unary', progression: 'unary', distribution_of_three: 'unary', size_series: 'unary', arithmetic: 'binary',
};
/** Which attributes each operation may act on (the taxonomy is closed — Doc 04 §4). */
export const OP_ATTRS: Record<Op, Attr[]> = {
  constant: ['shape', 'fill', 'size', 'rot', 'count'],
  progression: ['rot', 'size', 'count'],
  distribution_of_three: ['shape', 'fill', 'size', 'rot', 'count'],
  size_series: ['size'],
  arithmetic: ['count'],
};

export interface MatrixCell { shape: ShapeName; fill: FillName; size: SizeName; rot: number; count: number }
export interface Relation { id: string; arity: 'unary' | 'binary' | 'ternary'; attribute: Attr; op: Op; axis: 'row' | 'column'; params: Record<string, unknown> }
export interface Alphabet { shapes: ShapeName[]; fills: FillName[]; sizes: SizeName[]; rotations: number[]; counts: number[]; colours: string[] }
export interface MatrixPuzzle {
  family: 'matrix';
  canvas: { w: number; h: number; cells: [number, number] };
  alphabet: Alphabet;
  cells: (MatrixCell | null)[][];
  perceptual_organisation: 'separation' | 'integration' | 'embedding';
  distracting_attributes: Attr[];
}
export interface MatrixRule { relations: Relation[]; solution_cell: [number, number]; deterministic: boolean; unique_solution_required: boolean }

export type MatrixVerdict =
  | { verdict: 'key_confirmed'; derived: Partial<MatrixCell>; matching: number[] }
  | { verdict: 'no_rule' | 'contradictory_rule' | 'multiple_solutions' | 'no_solution' | 'key_mismatch'; detail: string; derived?: Partial<MatrixCell>; matching?: number[] };

const SIZE_ORDER: SizeName[] = ['s', 'm', 'l'];

function ordinal(attr: Attr, v: unknown): number {
  if (attr === 'size') return SIZE_ORDER.indexOf(v as SizeName);
  return Number(v);
}
function fromOrdinal(attr: Attr, n: number): unknown {
  if (attr === 'size') return SIZE_ORDER[n];
  if (attr === 'rot') return ((n % 360) + 360) % 360;
  return n;
}

function line(p: MatrixPuzzle, axis: 'row' | 'column', i: number): (MatrixCell | null)[] {
  return axis === 'row' ? p.cells[i]! : p.cells.map((r) => r[i]!);
}
function nLines(p: MatrixPuzzle, axis: 'row' | 'column'): number {
  return axis === 'row' ? p.cells.length : p.cells[0]!.length;
}

function lineHolds(rel: Relation, vals: unknown[]): boolean {
  const a = rel.attribute;
  switch (rel.op) {
    case 'constant':
      return vals.every((v) => v === vals[0]);
    case 'progression':
    case 'size_series': {
      const step = rel.op === 'size_series' ? 1 : Number(rel.params.step ?? 1);
      for (let k = 1; k < vals.length; k++) {
        const prev = ordinal(a, vals[k - 1]);
        const cur = ordinal(a, vals[k]);
        const expect = a === 'rot' ? (((prev + step) % 360) + 360) % 360 : prev + step;
        if (cur !== expect) return false;
      }
      return true;
    }
    case 'distribution_of_three': {
      const values = (rel.params.values as unknown[]) ?? [];
      if (values.length !== 3 || vals.length !== 3) return false;
      return values.every((v) => vals.includes(v)) && new Set(vals).size === 3;
    }
    case 'arithmetic': {
      if (vals.length !== 3) return false;
      const sign = rel.params.sign === '-' ? -1 : 1;
      return Number(vals[2]) === Number(vals[0]) + sign * Number(vals[1]);
    }
  }
}

/** Value implied for position k of a line where all other positions are known. */
function deriveInLine(rel: Relation, vals: unknown[], k: number): unknown {
  const a = rel.attribute;
  const known = vals.map((v, i) => (i === k ? undefined : v));
  switch (rel.op) {
    case 'constant':
      return known.find((v) => v !== undefined);
    case 'progression':
    case 'size_series': {
      const step = rel.op === 'size_series' ? 1 : Number(rel.params.step ?? 1);
      const j = k === 0 ? 1 : 0;
      const base = ordinal(a, known[j]);
      return fromOrdinal(a, base + step * (k - j));
    }
    case 'distribution_of_three': {
      const values = (rel.params.values as unknown[]) ?? [];
      const missing = values.filter((v) => !known.includes(v));
      return missing.length === 1 ? missing[0] : undefined;
    }
    case 'arithmetic': {
      const sign = rel.params.sign === '-' ? -1 : 1;
      const [x, y, z] = known.map((v) => (v === undefined ? NaN : Number(v)));
      if (k === 2) return x! + sign * y!;
      if (k === 0) return z! - sign * y!;
      return (z! - x!) * sign;
    }
  }
}

function eqAttr(attr: Attr, a: MatrixCell, b: MatrixCell): boolean {
  if (attr === 'rot') return visualRot(a.shape, a.rot) === visualRot(b.shape, b.rot);
  return a[attr] === b[attr];
}

export function visuallyEqual(a: MatrixCell, b: MatrixCell, attrs: readonly Attr[] = ATTRS): boolean {
  return attrs.every((k) => eqAttr(k, a, b));
}

/** Rule-bearing attributes: those named by a relation, plus attributes constant over the whole grid. */
export function determinedAttributes(p: MatrixPuzzle, r: MatrixRule): Attr[] {
  const filled = p.cells.flat().filter(Boolean) as MatrixCell[];
  const out = new Set<Attr>(r.relations.map((x) => x.attribute));
  for (const a of ATTRS) {
    if (p.distracting_attributes.includes(a)) continue;
    if (filled.every((c) => eqAttr(a, c, filled[0]!))) out.add(a);
  }
  return ATTRS.filter((a) => out.has(a));
}

function withCell(p: MatrixPuzzle, at: [number, number], cell: MatrixCell): MatrixPuzzle {
  return { ...p, cells: p.cells.map((row, i) => row.map((c, j) => (i === at[0] && j === at[1] ? cell : c))) };
}

/** Does `cell` placed in the solution slot satisfy every relation along every line? */
export function satisfiesAll(p: MatrixPuzzle, r: MatrixRule, cell: MatrixCell): boolean {
  const full = withCell(p, r.solution_cell, cell);
  for (const rel of r.relations) {
    const n = nLines(full, rel.axis);
    const vals: unknown[][] = [];
    for (let i = 0; i < n; i++) {
      const ln = line(full, rel.axis, i) as MatrixCell[];
      const v = ln.map((c) => c[rel.attribute]);
      if (!lineHolds(rel, v)) return false;
      vals.push(v);
    }
    // distribution_of_three is a Latin square: each value once per orthogonal line too.
    if (rel.op === 'distribution_of_three') {
      for (let k = 0; k < vals[0]!.length; k++) if (new Set(vals.map((v) => v[k])).size !== vals.length) return false;
    }
  }
  // Implicit constants must also hold.
  const det = determinedAttributes(p, r).filter((a) => !r.relations.some((x) => x.attribute === a));
  const ref = (p.cells.flat().find(Boolean) as MatrixCell) ?? cell;
  return det.every((a) => eqAttr(a, cell, ref));
}

export interface MatrixSolveInput { puzzle: MatrixPuzzle; rule: MatrixRule; options: MatrixCell[]; keyIndex: number }

/** Independent solver (Doc 04 §7). Only KEY_CONFIRMED passes. */
export function solveMatrix({ puzzle: p, rule: r, options, keyIndex }: MatrixSolveInput): MatrixVerdict {
  const [sr, sc] = r.solution_cell;
  if (p.cells[sr]?.[sc] !== null) return { verdict: 'no_solution', detail: 'solution_cell is not the empty slot' };
  const filled = p.cells.flat().filter(Boolean) as MatrixCell[];
  if (filled.length !== p.cells.flat().length - 1) return { verdict: 'no_solution', detail: 'grid must have exactly one empty slot' };

  // Every varying attribute must be ruled or declared distracting.
  for (const a of ATTRS) {
    const varies = !filled.every((c) => eqAttr(a, c, filled[0]!));
    if (varies && !r.relations.some((x) => x.attribute === a) && !p.distracting_attributes.includes(a))
      return { verdict: 'no_rule', detail: `attribute ${a} varies without a rule and is not declared distracting` };
  }
  // Step 1: each relation must hold on every complete line along its axis.
  for (const rel of r.relations) {
    if (!OP_ATTRS[rel.op]?.includes(rel.attribute)) return { verdict: 'no_rule', detail: `op ${rel.op} cannot act on ${rel.attribute}` };
    for (let i = 0; i < nLines(p, rel.axis); i++) {
      const ln = line(p, rel.axis, i);
      if (ln.some((c) => c === null)) continue;
      if (!lineHolds(rel, (ln as MatrixCell[]).map((c) => c[rel.attribute])))
        return { verdict: 'no_rule', detail: `relation ${rel.id} (${rel.op} on ${rel.attribute}) does not hold on ${rel.axis} ${i}` };
    }
  }
  // Step 2: derive the missing cell.
  const derived: Partial<MatrixCell> = {};
  for (const rel of r.relations) {
    const li = rel.axis === 'row' ? sr : sc;
    const k = rel.axis === 'row' ? sc : sr;
    const vals = line(p, rel.axis, li).map((c) => (c ? c[rel.attribute] : undefined));
    const v = deriveInLine(rel, vals, k);
    if (v === undefined || (typeof v === 'number' && Number.isNaN(v))) return { verdict: 'no_solution', detail: `relation ${rel.id} cannot determine the slot` };
    const prev = derived[rel.attribute];
    if (prev !== undefined && prev !== v) return { verdict: 'contradictory_rule', detail: `relations imply conflicting ${rel.attribute}` };
    (derived as Record<string, unknown>)[rel.attribute] = v;
  }
  const det = determinedAttributes(p, r);
  for (const a of det) if (derived[a] === undefined) (derived as Record<string, unknown>)[a] = filled[0]![a];

  // Steps 3–4: compare against options, and independently test each option in the slot.
  const matching = options.map((o, i) => (det.every((a) => (a === 'rot' ? visualRot(o.shape, o.rot) === visualRot(o.shape, Number(derived.rot)) : o[a] === derived[a])) && satisfiesAll(p, r, o) ? i : -1)).filter((i) => i >= 0);
  if (matching.length === 0) return { verdict: 'no_solution', detail: 'no option matches the derived cell', derived, matching };
  if (matching.length > 1) return { verdict: 'multiple_solutions', detail: `options ${matching.join(',')} all satisfy the rule`, derived, matching };
  if (matching[0] !== keyIndex) return { verdict: 'key_mismatch', detail: `solver derives option ${matching[0]}, key says ${keyIndex}`, derived, matching };
  return { verdict: 'key_confirmed', derived, matching };
}

// ── Fair-tree distractors (Doc 04 §6.1) ──────────────────────────────────────────────
function alphabetFor(alpha: Alphabet, a: Attr): unknown[] {
  return a === 'shape' ? alpha.shapes : a === 'fill' ? alpha.fills : a === 'size' ? alpha.sizes : a === 'rot' ? alpha.rotations : alpha.counts;
}

export function attrDistance(a: MatrixCell, b: MatrixCell, attrs: readonly Attr[] = ATTRS): number {
  return attrs.reduce((s, k) => s + (eqAttr(k, a, b) ? 0 : 1), 0);
}

export interface FairTreeResult { options: MatrixCell[]; keyIndex: number; attempts: number }

/**
 * Engine-owned distractor generation. Invariants: every distractor differs from the key on a
 * rule-bearing attribute; none duplicates another or satisfies the rule; the key is not the most
 * central option (mean distance to the others is not the minimum).
 */
export function fairTree(p: MatrixPuzzle, r: MatrixRule, key: MatrixCell, n: number, rng: Rng, stepsPerChild = 1, maxAttempts = 40): FairTreeResult | null {
  const ruleAttrs = determinedAttributes(p, r);
  const mutable = ruleAttrs.filter((a) => alphabetFor(p.alphabet, a).length > 1);
  if (!mutable.length) return null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const nodes: MatrixCell[] = [key];
    let guard = 0;
    while (nodes.length < n && guard++ < 500) {
      const parent = rng.pick(nodes);
      let child = parent;
      for (const attr of rng.sample(mutable, Math.min(stepsPerChild, mutable.length))) {
        const choices = alphabetFor(p.alphabet, attr).filter((v) => !eqAttr(attr, { ...child, [attr]: v } as MatrixCell, child));
        if (choices.length) child = { ...child, [attr]: rng.pick(choices) } as MatrixCell;
      }
      if (child === parent) continue;
      if (nodes.some((x) => visuallyEqual(x, child))) continue;
      if (satisfiesAll(p, r, child)) continue;
      if (visuallyEqual(child, key, ruleAttrs)) continue;
      nodes.push(child);
    }
    if (nodes.length < n) continue;
    const meanDist = nodes.map((x) => nodes.reduce((s, y) => s + attrDistance(x, y), 0) / (n - 1));
    const minD = Math.min(...meanDist);
    const keyIsUniqueMin = meanDist[0] === minD && meanDist.filter((d) => d === minD).length === 1;
    if (keyIsUniqueMin) continue;
    const order = rng.shuffle(nodes.map((_, i) => i));
    return { options: order.map((i) => nodes[i]!), keyIndex: order.indexOf(0), attempts: attempt };
  }
  return null;
}

// ── Context-blind solver (Doc 04 §6.2): centrality heuristic + attribute-frequency vote ──
export function contextBlindMatrix(options: MatrixCell[]): number[] {
  const n = options.length;
  const toDist = (scores: number[], higherBetter: boolean) => {
    const best = higherBetter ? Math.max(...scores) : Math.min(...scores);
    const winners = scores.map((s) => (Math.abs(s - best) < 1e-9 ? 1 : 0));
    const w = winners.reduce((s, x) => s + x, 0 as number);
    return winners.map((x) => x / w);
  };
  const centrality = options.map((x) => options.reduce((s, y) => s + attrDistance(x, y), 0));
  const freq = options.map((x) => ATTRS.reduce((s, a) => s + options.filter((y) => eqAttr(a, x, y)).length, 0));
  const c = toDist(centrality, false);
  const v = toDist(freq, true);
  return Array.from({ length: n }, (_, i) => (c[i]! + v[i]!) / 2);
}

// ── Canonical form (Doc 04 §8) ───────────────────────────────────────────────────────
export function canonicalMatrix(p: MatrixPuzzle, r: MatrixRule): string {
  const variants: string[] = [];
  for (const transpose of [false, true]) {
    let cells = p.cells;
    let rels = r.relations;
    if (transpose) {
      cells = p.cells[0]!.map((_, j) => p.cells.map((row) => row[j]!));
      rels = r.relations.map((x) => ({ ...x, axis: x.axis === 'row' ? 'column' : 'row' }));
    }
    // Relabel nominal attributes by first appearance so renamings collapse.
    const maps: Record<string, Map<unknown, number>> = { shape: new Map(), fill: new Map() };
    const flat = cells.flat();
    for (const c of flat) if (c) for (const a of ['shape', 'fill'] as const) if (!maps[a]!.has(c[a])) maps[a]!.set(c[a], maps[a]!.size);
    const canonCells = cells.map((row) => row.map((c) => (c ? { shape: maps.shape!.get(c.shape), fill: maps.fill!.get(c.fill), size: c.size, rot: visualRot(c.shape, c.rot), count: c.count } : null)));
    const canonRels = rels
      .map((x) => ({ attribute: x.attribute, op: x.op, axis: x.axis, params: x.attribute === 'shape' || x.attribute === 'fill' ? { ...x.params, values: ((x.params.values as unknown[]) ?? []).map((v) => maps[x.attribute]!.get(v)).sort() } : x.params }))
      .sort((a, b) => `${a.attribute}|${a.op}|${a.axis}`.localeCompare(`${b.attribute}|${b.op}|${b.axis}`));
    variants.push(canonicalJson({ cells: canonCells, rels: canonRels, org: p.perceptual_organisation, distract: [...p.distracting_attributes].sort() }));
  }
  return variants.sort()[0]!;
}

export function matrixTokens(p: MatrixPuzzle, r: MatrixRule): string[] {
  const t: string[] = [`grid:${p.cells.length}x${p.cells[0]!.length}`, `org:${p.perceptual_organisation}`, `rules:${r.relations.length}`];
  for (const x of r.relations) t.push(`op:${x.attribute}:${x.op}:${x.axis}`, `arity:${x.arity}`);
  for (const a of p.distracting_attributes) t.push(`distract:${a}`);
  p.cells.forEach((row, i) => row.forEach((c, j) => {
    if (c) for (const a of ATTRS) t.push(`r${i}c${j}:${a}=${a === 'rot' ? visualRot(c.shape, c.rot) : c[a]}`);
  }));
  return t;
}
