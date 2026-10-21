// Seeded PRNG. Every random choice in authoring, rendering, distractor generation and
// trial expansion goes through this so that blueprint + seed → identical output (Doc 01 §1.4).

export interface Rng {
  readonly seed: number;
  next(): number; // [0, 1)
  int(n: number): number; // [0, n)
  range(lo: number, hi: number): number; // [lo, hi)
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  sample<T>(items: readonly T[], k: number): T[];
  chance(p: number): boolean;
  fork(label: string): Rng;
}

/** FNV-1a 32-bit. Stable across platforms; used to derive sub-seeds from labels. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed: number): Rng {
  // sfc32, seeded through splitmix32 so small/adjacent seeds diverge immediately.
  let s = seed >>> 0;
  const split = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  let a = split();
  let b = split();
  let c = split();
  let d = split();
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();

  const rng: Rng = {
    seed: seed >>> 0,
    next,
    int: (n) => Math.floor(next() * n),
    range: (lo, hi) => lo + next() * (hi - lo),
    pick: (items) => {
      if (items.length === 0) throw new Error('pick from empty list');
      return items[Math.floor(next() * items.length)]!;
    },
    shuffle: (items) => {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
    sample: (items, k) => rng.shuffle(items).slice(0, k),
    chance: (p) => next() < p,
    fork: (label) => createRng((hashString(label) ^ Math.imul(seed >>> 0, 0x27d4eb2d)) >>> 0),
  };
  return rng;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
