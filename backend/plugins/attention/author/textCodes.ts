import type { Rng } from '@cognimetric/core';

// Shared material for the written attention questions: an unambiguous code alphabet and the
// visually confusable character pairs that make a one-character difference hard to spot.

/** Upper-case letters and digits; no characters that differ only by case. */
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.split('');

/** Character pairs that look alike at a glance (shape confusions). */
export const CONFUSABLE: Record<string, string[]> = {
  O: ['Q', 'D', '0'], Q: ['O'], D: ['O'], C: ['G'], G: ['C', '6'], '6': ['G', '8'], '8': ['B', '6'], B: ['8', 'R'],
  E: ['F'], F: ['E', 'P'], P: ['R', 'F'], R: ['P', 'B'], M: ['N', 'W'], N: ['M'], W: ['M', 'V'], V: ['U', 'W'], U: ['V'],
  S: ['5'], '5': ['S'], Z: ['2'], '2': ['Z'], K: ['X'], X: ['K', 'Y'], Y: ['X'], T: ['Y'], H: ['N'], '3': ['8'], L: ['J'], J: ['L'], '7': ['T'],
};

export const isConfusable = (a: string, b: string) => (CONFUSABLE[a] ?? []).includes(b) || (CONFUSABLE[b] ?? []).includes(a);

/** Letter groups that share strokes, used for the letter-count question. */
export const LETTER_GROUPS = [['E', 'F', 'P', 'R', 'B'], ['O', 'Q', 'C', 'G', 'D'], ['M', 'N', 'W', 'V'], ['T', 'L', 'J', 'Y'], ['K', 'X', 'Z', 'H']];
export const groupOf = (c: string) => LETTER_GROUPS.find((g) => g.includes(c)) ?? [];

/** Codes are shown in pairs on one answer row. */
export const PAIR_SEP = '  —  ';

/** Integer in [lo, hi]. */
export const between = (rng: Rng, lo: number, hi: number) => lo + rng.int(hi - lo + 1);
