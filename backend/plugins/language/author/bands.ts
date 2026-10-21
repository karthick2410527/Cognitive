// Lever bands, shared by the authors and the lexical solver so both read the same definition.
import type { LexEntry, Levers } from '@cognimetric/core';

export const ZIPF: Record<string, [number, number]> = { high: [4.6, 9], mid: [3.9, 4.9], low: [3.0, 4.0], rare: [0, 3.2] };
export const AOA: Record<string, [number, number]> = { early: [0, 5.5], mid: [5.0, 9.5], late: [8.5, 13], very_late: [10.5, 30] };
export const IMAG: Record<string, [number, number]> = { high: [6.0, 7.1], medium: [5.3, 6.3] };
export const DISTANCE: Record<string, number> = { unrelated: 2, same_broad_category: 1, same_narrow_category: 1 };

const inBand = (x: number, [lo, hi]: [number, number]) => x >= lo && x <= hi;

export function keyMatches(e: LexEntry, L: Levers, ignore: string[] = []): boolean {
  return (ignore.includes('word_frequency') || inBand(e.zipf, ZIPF[String(L.word_frequency)] ?? [0, 9]))
    && (ignore.includes('age_of_acquisition') || inBand(e.aoa, AOA[String(L.age_of_acquisition)] ?? [0, 30]))
    && (ignore.includes('imageability') || inBand(e.imageability, IMAG[String(L.imageability)] ?? [0, 8]));
}

export function bandViolations(e: LexEntry, L: Levers): string[] {
  const out: string[] = [];
  if (L.word_frequency && !inBand(e.zipf, ZIPF[String(L.word_frequency)]!)) out.push(`word_frequency: ${e.word} zipf ${e.zipf}`);
  if (L.age_of_acquisition && !inBand(e.aoa, AOA[String(L.age_of_acquisition)]!)) out.push(`age_of_acquisition: ${e.word} aoa ${e.aoa}`);
  if (L.imageability && !inBand(e.imageability, IMAG[String(L.imageability)]!)) out.push(`imageability: ${e.word} ${e.imageability}`);
  return out;
}

/** Content-word overlap between a definition and a lexicon gloss (Jaccard on stems). */
const STOP = new Set(['a', 'an', 'the', 'of', 'for', 'to', 'and', 'or', 'with', 'in', 'on', 'that', 'is', 'it', 'its', 'by', 'from', 'at', 'as', 'be', 'used', 'are', 'can', 'which', 'you', 'into', 'one', 'two', 'has', 'have', 'often', 'very', 'like', 'made', 'its']);
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, '');
export function glossOverlap(a: string, b: string): number {
  const toks = (s: string) => new Set(s.toLowerCase().match(/[a-z]+/g)?.filter((w) => !STOP.has(w)).map(stem) ?? []);
  const x = toks(a);
  const y = toks(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter++;
  return inter / (x.size + y.size - inter);
}
