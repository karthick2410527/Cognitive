// Lever policy (θ → levers, Doc 03 §5) and band arithmetic. Anchored interpolation: continuous
// levers numerically, ordinal levers by rounding to a permitted value, enums by nearest anchor,
// with small jitter on continuous levers so items in a cell are not identical.
import type { LeverDef, Levers, LeverValue, Manifest, Rng, TaskTypeDef } from '@cognimetric/core';

export function anchorsFor(m: Manifest, taskType: string): Record<string, Levers> {
  const a = m.lever_policy.anchors[taskType] ?? m.lever_policy.anchors['*'];
  if (!a) throw new Error(`no lever anchors for ${m.plugin_id}/${taskType}`);
  return a as Record<string, Levers>;
}

export function anchorRange(m: Manifest, taskType: string): [number, number] {
  const ks = Object.keys(anchorsFor(m, taskType)).map(Number).sort((x, y) => x - y);
  return [ks[0]!, ks[ks.length - 1]!];
}

function nearestPermitted(def: LeverDef, x: number): number {
  const vals = (def.values ?? []).map(Number).filter((v) => Number.isFinite(v));
  if (!vals.length) return Math.round(x);
  return vals.reduce((best, v) => (Math.abs(v - x) < Math.abs(best - x) ? v : best), vals[0]!);
}

export function resolveLevers(m: Manifest, tt: TaskTypeDef, theta: number, rng?: Rng): Levers {
  const anchors = anchorsFor(m, tt.id);
  const keys = Object.keys(anchors).map(Number).sort((a, b) => a - b);
  const t = Math.min(keys[keys.length - 1]!, Math.max(keys[0]!, theta));
  let lo = keys[0]!;
  let hi = keys[keys.length - 1]!;
  for (let i = 0; i < keys.length - 1; i++) if (t >= keys[i]! && t <= keys[i + 1]!) { lo = keys[i]!; hi = keys[i + 1]!; break; }
  const A = anchors[keyOf(anchors, lo)]!;
  const B = anchors[keyOf(anchors, hi)]!;
  const f = hi === lo ? 0 : (t - lo) / (hi - lo);
  const out: Levers = {};
  for (const name of tt.levers) {
    const def = m.difficulty_levers[name]!;
    const a = A[name];
    const b = B[name];
    let v: LeverValue = (f < 0.5 ? a : b) as LeverValue;
    if (typeof a === 'number' && typeof b === 'number') {
      const x = a + (b - a) * f;
      if (def.type === 'ordinal') v = nearestPermitted(def, x);
      else if (def.type === 'continuous') {
        const j = m.lever_policy.jitter[name] ?? 0;
        let y = x * (1 + (rng && j ? rng.range(-j, j) : 0));
        if (def.range) y = Math.min(def.range[1], Math.max(def.range[0], y));
        v = Number.isInteger(a) && Number.isInteger(b) && Math.abs(y) >= 10 ? Math.round(y) : Math.round(y * 1000) / 1000;
      } else v = x;
    }
    out[name] = v;
  }
  return out;
}

function keyOf(anchors: Record<string, unknown>, n: number): string {
  return Object.keys(anchors).find((k) => Number(k) === n)!;
}

export function bandCenters(width: number): number[] {
  const out: number[] = [];
  for (let c = -3; c <= 3 + 1e-9; c += width) out.push(Math.round(c * 1000) / 1000);
  return out;
}

export function bandOf(b: number, width: number): number {
  return bandCenters(width).reduce((best, c) => (Math.abs(c - b) < Math.abs(best - b) ? c : best), 0);
}

/** Bands a task type can be generated for: centres inside its anchor range (±half a band). */
export function coverageBands(m: Manifest, tt: TaskTypeDef): number[] {
  const [lo, hi] = anchorRange(m, tt.id);
  const w = m.bank.b_band_width;
  return bandCenters(w).filter((c) => c >= lo - w / 2 && c <= hi + w / 2);
}

export const difficultyBand = (b: number): 'easy' | 'medium' | 'hard' => (b < -0.75 ? 'easy' : b > 0.75 ? 'hard' : 'medium');

/** Validate a lever vector against the manifest definitions (used at boot and before L2). */
export function leverValueOk(def: LeverDef, v: unknown): boolean {
  if (def.type === 'continuous') return typeof v === 'number' && (!def.range || (v >= def.range[0] - 1e-9 && v <= def.range[1] + 1e-9));
  if (def.type === 'boolean') return typeof v === 'boolean';
  if (def.values) return def.values.some((x) => x === v || String(x) === String(v));
  return v !== undefined;
}
