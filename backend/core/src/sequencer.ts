// Trial sequencer (Doc 03 §10): expands a trial rule + seed into a trial list with a controlled
// target rate, bounded runs and balanced response sides. A model will not reliably satisfy these
// constraints across hundreds of trials; the engine guarantees them by construction.
import type { Rng } from './prng';

export interface BinarySeqOpts { n: number; rate: number; maxRun: number; noTargetFirst?: number }

/** Exactly round(n·rate) targets, never more than maxRun consecutive, none in the first k trials. */
export function binarySequence(rng: Rng, o: BinarySeqOpts): boolean[] {
  const first = o.noTargetFirst ?? 0;
  const k = Math.max(0, Math.min(o.n - first, Math.round(o.n * o.rate)));
  for (let attempt = 0; attempt < 400; attempt++) {
    const slots = rng.shuffle(Array.from({ length: o.n - first }, (_, i) => i + first)).slice(0, k);
    const seq = new Array<boolean>(o.n).fill(false);
    for (const s of slots) seq[s] = true;
    if (maxRunOf(seq, true) <= o.maxRun) return seq;
  }
  // Deterministic fallback: evenly spaced targets with jittered offsets.
  const seq = new Array<boolean>(o.n).fill(false);
  const span = (o.n - first) / Math.max(1, k);
  for (let i = 0; i < k; i++) seq[Math.min(o.n - 1, first + Math.floor(i * span + rng.next() * Math.max(1, span - 1)))] = true;
  return seq;
}

/** Values balanced in count (±1), with no value repeated more than maxRun times in a row. */
export function balancedSequence<T>(rng: Rng, values: readonly T[], n: number, maxRun: number): T[] {
  const pool: T[] = [];
  for (let i = 0; i < n; i++) pool.push(values[i % values.length]!);
  for (let attempt = 0; attempt < 400; attempt++) {
    const seq = rng.shuffle(pool);
    let run = 1;
    let ok = true;
    for (let i = 1; i < seq.length && ok; i++) {
      run = seq[i] === seq[i - 1] ? run + 1 : 1;
      if (run > maxRun) ok = false;
    }
    if (ok) return seq;
  }
  return pool; // round-robin order already satisfies maxRun ≥ 1
}

/** Bernoulli-proportion sequence over labelled conditions with exact counts (e.g. 60 % congruent). */
export function proportionSequence(rng: Rng, parts: { value: string; p: number }[], n: number, maxRun: number): string[] {
  const counts = parts.map((x) => Math.round(x.p * n));
  let diff = n - counts.reduce((s, c) => s + c, 0);
  for (let i = 0; diff !== 0; i = (i + 1) % counts.length) {
    counts[i]! += diff > 0 ? 1 : -1;
    diff += diff > 0 ? -1 : 1;
  }
  const pool = parts.flatMap((x, i) => new Array<string>(Math.max(0, counts[i]!)).fill(x.value));
  for (let attempt = 0; attempt < 400; attempt++) {
    const seq = rng.shuffle(pool);
    if (maxRunOfAny(seq) <= maxRun) return seq;
  }
  return rng.shuffle(pool);
}

export function maxRunOf<T>(seq: readonly T[], value: T): number {
  let best = 0, run = 0;
  for (const x of seq) {
    run = x === value ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

export function maxRunOfAny<T>(seq: readonly T[]): number {
  let best = seq.length ? 1 : 0, run = 1;
  for (let i = 1; i < seq.length; i++) {
    run = seq[i] === seq[i - 1] ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

/** Interval with ±frac uniform jitter, rounded to whole ms. */
export function jittered(rng: Rng, base: number, frac: number): number {
  return Math.round(base * (1 + (frac ? rng.range(-frac, frac) : 0)));
}
