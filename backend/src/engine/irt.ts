// Measurement model (Doc 05 §3–4): 2PL per dimension with declared MIRT loadings, staircase for the
// first two responses in a domain, EAP on a 61-point quadrature grid from the third. MLE is
// computed alongside for diagnostics only.

export type Observation =
  | { kind: 'binary'; a: number; b: number; u: number; loading: number } // u ∈ [0,1]: fractional item score
  | { kind: 'normal'; perf: number; s: number; loading: number }; // timed block folded onto the θ scale

export const p2pl = (theta: number, a: number, b: number) => 1 / (1 + Math.exp(-a * (theta - b)));
export const info2pl = (theta: number, a: number, b: number) => {
  const p = p2pl(theta, a, b);
  return a * a * p * (1 - p);
};

export const GRID: number[] = Array.from({ length: 61 }, (_, i) => -4 + (8 * i) / 60);

function logLik(theta: number, obs: Observation[]): number {
  let ll = 0;
  for (const o of obs) {
    if (o.loading <= 0) continue;
    if (o.kind === 'binary') {
      const p = Math.min(1 - 1e-9, Math.max(1e-9, p2pl(theta, o.a * o.loading, o.b)));
      ll += o.u * Math.log(p) + (1 - o.u) * Math.log(1 - p);
    } else {
      const s = o.s / Math.sqrt(o.loading);
      ll += -((theta - o.perf) ** 2) / (2 * s * s);
    }
  }
  return ll;
}

export interface Estimate { theta: number; se: number; mle: number | null }

export function eap(obs: Observation[], prior = { mu: 0, sigma: 1 }): Estimate {
  const lp = GRID.map((t) => logLik(t, obs) - ((t - prior.mu) ** 2) / (2 * prior.sigma ** 2));
  const m = Math.max(...lp);
  const w = lp.map((x) => Math.exp(x - m));
  const z = w.reduce((s, x) => s + x, 0);
  const theta = GRID.reduce((s, t, i) => s + t * w[i]!, 0) / z;
  const v = GRID.reduce((s, t, i) => s + (t - theta) ** 2 * w[i]!, 0) / z;
  return { theta, se: Math.sqrt(v), mle: mle(obs) };
}

export function mle(obs: Observation[]): number | null {
  if (!obs.length) return null;
  const allBinary = obs.every((o) => o.kind === 'binary');
  if (allBinary && (obs.every((o) => (o as { u: number }).u >= 1) || obs.every((o) => (o as { u: number }).u <= 0))) return null;
  let best = -Infinity;
  let arg = 0;
  for (let t = -4; t <= 4.0001; t += 0.01) {
    const l = logLik(t, obs);
    if (l > best) { best = l; arg = t; }
  }
  return Math.abs(arg) >= 3.99 ? null : Math.round(arg * 100) / 100;
}

/** v1's staircase, unchanged, for n < 2 responses in a domain (Doc 05 §4.1). SE is a fixed 1.0. */
export function staircase(theta: number, correct: boolean, rtMs: number | null, timeLimitMs: number | null): number {
  let pace = 'normal';
  if (rtMs !== null && timeLimitMs) {
    const r = rtMs / timeLimitMs;
    pace = r <= 0.4 ? 'fast' : r >= 0.85 ? 'slow' : 'normal';
  }
  const delta = correct ? (pace === 'fast' ? 0.65 : pace === 'slow' ? 0.2 : 0.4) : pace === 'fast' ? -0.3 : pace === 'slow' ? -0.75 : -0.5;
  return Math.min(3, Math.max(-3, theta + delta));
}

/** Observation noise for a timed block: matches the 2PL peak information a²/4, widened for difference scores. */
export const blockSd = (a: number, differenceScore: boolean) => (2 / a) * (differenceScore ? 1.25 : 1);

/** Standardised person-fit residual (lz-like) for the confirmation-block misfit trigger. */
export function personFit(theta: number, obs: Observation[]): number {
  const bin = obs.filter((o): o is Extract<Observation, { kind: 'binary' }> => o.kind === 'binary');
  if (bin.length < 4) return 0;
  let s = 0;
  for (const o of bin) {
    const p = p2pl(theta, o.a * o.loading, o.b);
    s += (o.u - p) ** 2 / Math.max(1e-6, p * (1 - p));
  }
  return (s - bin.length) / Math.sqrt(2 * bin.length);
}
