// Positional rule families for number sequences (term j counted from 0). Used by the series solvers
// to re-derive what a sequence does, independently of how the author built it.
export type SeriesRule = 'add_constant' | 'alternating_add' | 'multiply' | 'increasing_step' | 'fibonacci_like';
export const RULES: SeriesRule[] = ['add_constant', 'alternating_add', 'multiply', 'increasing_step', 'fibonacci_like'];

type Pt = [number, number]; // [position, value]
export interface Fit { rule: SeriesRule; at: (j: number) => number }

const near = (x: number, y: number) => Math.abs(x - y) < 1e-6;

/** Exact solve of a k×k linear system (k ≤ 3); null when singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    while (p < n && Math.abs(M[p]![c]!) < 1e-12) p++;
    if (p === n) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((r, i) => r[n]! / r[i]!);
}

/** Fits a linear-in-parameters family exactly through the points (using any k independent rows). */
function linearFit(pts: Pt[], basis: (j: number) => number[]): ((j: number) => number) | null {
  const k = basis(0).length;
  if (pts.length < k + 1) return null; // need at least one point beyond the fit to confirm the rule
  for (let s = 0; s + k <= pts.length; s++) {
    const rows = pts.slice(s, s + k);
    const w = solve(rows.map(([j]) => basis(j)), rows.map(([, v]) => v));
    if (!w) continue;
    const at = (j: number) => basis(j).reduce((a, x, i) => a + x * w[i]!, 0);
    return pts.every(([j, v]) => near(at(j), v)) ? at : null;
  }
  return null;
}

const FAMILIES: Record<SeriesRule, (pts: Pt[]) => ((j: number) => number) | null> = {
  add_constant: (pts) => {
    const f = linearFit(pts, (j) => [1, j]);
    return f && !near(f(1) - f(0), 0) ? f : null;
  },
  alternating_add: (pts) => {
    const f = linearFit(pts, (j) => [1, Math.ceil(j / 2), Math.floor(j / 2)]);
    if (!f) return null;
    const p = f(1) - f(0), q = f(2) - f(1);
    return near(p, q) ? null : f;
  },
  increasing_step: (pts) => {
    const f = linearFit(pts, (j) => [1, j, (j * (j - 1)) / 2]);
    if (!f) return null;
    const c = f(2) - 2 * f(1) + f(0);
    return near(c, 0) ? null : f;
  },
  multiply: (pts) => {
    if (pts.length < 3) return null;
    const [[j1, v1], [j2, v2]] = pts as [Pt, Pt];
    if (!v1 || !v2) return null;
    for (const r of [2, 3, 4, 5]) {
      if (!near(v2 / v1, r ** (j2 - j1))) continue;
      const a = v1 / r ** j1;
      const at = (j: number) => a * r ** j;
      if (pts.every(([j, v]) => near(at(j), v))) return at;
    }
    return null;
  },
  fibonacci_like: (pts) => {
    // Needs the first two terms and at least two more, all consecutive from position 0.
    const byPos = new Map(pts);
    if (!byPos.has(0) || !byPos.has(1) || pts.length < 4) return null;
    const max = Math.max(...pts.map(([j]) => j));
    const seq = [byPos.get(0)!, byPos.get(1)!];
    for (let j = 2; j <= max + 1; j++) seq.push(seq[j - 1]! + seq[j - 2]!);
    if (!pts.every(([j, v]) => near(seq[j]!, v))) return null;
    return (j: number) => {
      while (seq.length <= j) seq.push(seq[seq.length - 1]! + seq[seq.length - 2]!);
      return seq[j]!;
    };
  },
};

/** Every rule family that reproduces all the given points. */
export function fits(pts: Pt[]): Fit[] {
  const out: Fit[] = [];
  for (const rule of RULES) {
    const at = FAMILIES[rule](pts);
    if (at) out.push({ rule, at });
  }
  return out;
}

export const parseTerms = (s: string) => s.split(/[,\s]+/).map((x) => x.trim()).filter((x) => x && x !== '?').map(Number);
