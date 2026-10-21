// Robust statistics shared by block scorers (Doc 09 §5.2) and the psychometric engine.

export const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function sd(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Coefficient of variation as specified in Doc 09 §5.2: SD / median. */
export const rtCv = (xs: number[]): number => sd(xs) / median(xs);

/** Least-squares slope of y on x. */
export function slope(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return NaN;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  return den ? num / den : NaN;
}

export function normCdf(z: number): number {
  // Abramowitz–Stegun 7.1.26 on erf.
  const t = 1 / (1 + 0.3275911 * Math.abs(z / Math.SQRT2));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Inverse standard-normal CDF (Acklam's rational approximation). */
export function probit(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - pl) return -probit(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** d′ with the log-linear correction (Hautus 1995), plus bias c (Doc 07 §5.2). */
export function dPrime(hits: number, misses: number, fas: number, crs: number): { d: number; c: number } {
  const hr = (hits + 0.5) / (hits + misses + 1);
  const far = (fas + 0.5) / (fas + crs + 1);
  const zh = probit(hr);
  const zf = probit(far);
  return { d: zh - zf, c: -(zh + zf) / 2 };
}

/** Trim per Doc 06 §6.3 / Doc 09 §5.2: drop < 150 ms anticipations and > 3× individual median lapses. */
export function trimRts(rts: number[]): { kept: number[]; anticipations: number; lapses: number } {
  const valid = rts.filter((r) => Number.isFinite(r));
  const anticipations = valid.filter((r) => r < 150).length;
  const noAnt = valid.filter((r) => r >= 150);
  const med = median(noAnt);
  const lapses = Number.isFinite(med) ? noAnt.filter((r) => r > 3 * med).length : 0;
  const kept = Number.isFinite(med) ? noAnt.filter((r) => r <= 3 * med) : noAnt;
  return { kept, anticipations, lapses };
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const round = (x: number, dp = 3) => (Number.isFinite(x) ? Math.round(x * 10 ** dp) / 10 ** dp : x);
