import { describe, expect, it } from 'vitest';
import {
  binarySequence, balancedSequence, canonicalMatrix, contextBlindMatrix, createRng, dPrime, fairTree, maxRunOf, median, proportionSequence,
  renderMatrix, renderStimulus, satisfiesAll, solveMatrix, trimRts, visuallyEqual, attrDistance,
  type MatrixCell, type MatrixPuzzle, type MatrixRule,
} from '../src';

const cell = (shape: MatrixCell['shape'], rot: number, fill: MatrixCell['fill'] = 'solid', count = 1): MatrixCell => ({ shape, fill, size: 'm', rot, count });

function rotationPuzzle(): { p: MatrixPuzzle; r: MatrixRule; key: MatrixCell } {
  const rows = [[0, 45, 90], [90, 135, 180], [180, 225, 270]];
  const cells = rows.map((row, i) => row.map((rot, j) => (i === 2 && j === 2 ? null : cell('arrow', rot))));
  const p: MatrixPuzzle = { family: 'matrix', canvas: { w: 480, h: 480, cells: [3, 3] }, alphabet: { shapes: ['arrow', 'chevron'], fills: ['solid', 'outline', 'light', 'hatched'], sizes: ['s', 'm', 'l'], rotations: [0, 45, 90, 135, 180, 225, 270, 315], counts: [1, 2, 3], colours: ['ink'] }, cells, perceptual_organisation: 'separation', distracting_attributes: [] };
  const r: MatrixRule = { relations: [{ id: 'r1', arity: 'unary', attribute: 'rot', op: 'progression', axis: 'row', params: { step: 45 } }], solution_cell: [2, 2], deterministic: true, unique_solution_required: true };
  return { p, r, key: cell('arrow', 270) };
}

describe('prng', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = createRng(42), b = createRng(42), c = createRng(43);
    const xs = [a.next(), a.next(), a.next()];
    expect([b.next(), b.next(), b.next()]).toEqual(xs);
    expect(c.next()).not.toEqual(xs[0]);
  });
});

describe('trial sequencer', () => {
  it('meets target rate, run length and no-early-target constraints for any seed', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const s = binarySequence(createRng(seed), { n: 120, rate: 0.11, maxRun: 2, noTargetFirst: 5 });
      expect(s.filter(Boolean).length).toBe(Math.round(120 * 0.11));
      expect(maxRunOf(s, true)).toBeLessThanOrEqual(2);
      expect(s.slice(0, 5).some(Boolean)).toBe(false);
    }
  });
  it('balances values and conditions exactly', () => {
    const b = balancedSequence(createRng(3), ['L', 'R'], 100, 3);
    expect(b.filter((x) => x === 'L').length).toBe(50);
    const p = proportionSequence(createRng(4), [{ value: 'c', p: 0.6 }, { value: 'i', p: 0.4 }], 120, 4);
    expect(p.filter((x) => x === 'c').length).toBe(72);
  });
});

describe('matrix solver', () => {
  it('confirms a correct key and rejects a wrong one', () => {
    const { p, r, key } = rotationPuzzle();
    const opts = [cell('arrow', 225), key, cell('arrow', 315), cell('chevron', 270)];
    expect(solveMatrix({ puzzle: p, rule: r, options: opts, keyIndex: 1 }).verdict).toBe('key_confirmed');
    expect(solveMatrix({ puzzle: p, rule: r, options: opts, keyIndex: 0 }).verdict).toBe('key_mismatch');
  });
  it('catches a declared rule the grid does not follow (NO_RULE)', () => {
    const { p, r } = rotationPuzzle();
    const bad = { ...r, relations: [{ ...r.relations[0]!, params: { step: 90 } }] };
    expect(solveMatrix({ puzzle: p, rule: bad, options: [cell('arrow', 270)], keyIndex: 0 }).verdict).toBe('no_rule');
  });
  it('detects multiple solutions', () => {
    const { p, r, key } = rotationPuzzle();
    expect(solveMatrix({ puzzle: p, rule: r, options: [key, { ...key }], keyIndex: 0 }).verdict).toBe('multiple_solutions');
  });
  it('treats rotations of symmetric shapes as visually identical', () => {
    expect(visuallyEqual(cell('square', 0), cell('square', 90))).toBe(true);
    expect(visuallyEqual(cell('arrow', 0), cell('arrow', 90))).toBe(false);
  });
});

describe('fair-tree distractors', () => {
  it('guarantees the three invariants', () => {
    const { p, r, key } = rotationPuzzle();
    for (let seed = 1; seed <= 100; seed++) {
      const ft = fairTree(p, r, key, 5, createRng(seed));
      expect(ft).not.toBeNull();
      const { options, keyIndex } = ft!;
      expect(visuallyEqual(options[keyIndex]!, key)).toBe(true);
      options.forEach((o, i) => { if (i !== keyIndex) expect(satisfiesAll(p, r, o)).toBe(false); });
      expect(new Set(options.map((o) => JSON.stringify(o))).size).toBe(options.length);
      const mean = options.map((x) => options.reduce((s, y) => s + attrDistance(x, y), 0));
      const min = Math.min(...mean);
      expect(mean[keyIndex] === min && mean.filter((m) => m === min).length === 1).toBe(false);
    }
  });
});

describe('canonical form', () => {
  it('is invariant under transposition and shape relabelling', () => {
    const { p, r } = rotationPuzzle();
    const t: MatrixPuzzle = { ...p, cells: p.cells[0]!.map((_, j) => p.cells.map((row) => row[j]!)) };
    const tr: MatrixRule = { ...r, relations: r.relations.map((x) => ({ ...x, axis: 'column' as const })) };
    expect(canonicalMatrix(t, tr)).toBe(canonicalMatrix(p, r));
    const relabel: MatrixPuzzle = { ...p, cells: p.cells.map((row) => row.map((c) => (c ? { ...c, shape: 'chevron' as const } : null))) };
    expect(canonicalMatrix(relabel, r)).toBe(canonicalMatrix(p, r));
  });
});

describe('deterministic renderer', () => {
  it('renders byte-identical SVG for the same input', () => {
    const { p } = rotationPuzzle();
    expect(renderMatrix(p, 'default', 'x')).toBe(renderMatrix(structuredClone(p), 'default', 'x'));
    const s = { kind: 'arrows', dirs: ['L', 'L', 'R', 'L', 'L'] } as const;
    expect(renderStimulus({ ...s, dirs: [...s.dirs] }, 'high_contrast', 'y')).toBe(renderStimulus({ ...s, dirs: [...s.dirs] }, 'high_contrast', 'y'));
    expect(renderMatrix(p, 'default', 'x')).not.toMatch(/<text|font-family/);
  });
});

describe('statistics', () => {
  it('trims anticipations and lapses and uses medians', () => {
    const t = trimRts([100, 300, 310, 320, 330, 2000]);
    expect(t.anticipations).toBe(1);
    expect(t.lapses).toBe(1);
    expect(median(t.kept)).toBe(315);
  });
  it('computes a finite d′ for perfect performance (log-linear correction)', () => {
    const { d } = dPrime(20, 0, 0, 40);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(2);
  });
  it('context-blind solver splits ties evenly', () => {
    const opts = [cell('arrow', 0), cell('arrow', 90), cell('arrow', 180), cell('arrow', 270)];
    expect(contextBlindMatrix(opts)).toEqual([0.25, 0.25, 0.25, 0.25]);
  });
});
