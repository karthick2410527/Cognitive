import { surfaceOddness, type LexEntry, type LexicalService, type Rng } from '@cognimetric/core';

/** Retry until the options alone do not single out the key on surface form (length, syllables, initial, frequency). */
export function surfaceSafe(lex: LexicalService, options: string[], key: string, tolPp = 8): boolean {
  const p = surfaceOddness(options, (w) => lex.lookup(w)?.zipf ?? 0)[options.indexOf(key)]!;
  return p <= 1 / options.length + tolPp / 100;
}

export const closeTo = (k: LexEntry, tol = 1.0) => (e: LexEntry) => Math.abs(e.zipf - k.zipf) <= tol && Math.abs(e.word.length - k.word.length) <= 4;

export function distinctBy<T>(rng: Rng, xs: T[], key: (x: T) => string, n: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of rng.shuffle(xs)) {
    const k = key(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
    if (out.length === n) break;
  }
  return out;
}
