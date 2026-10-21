// Canonical JSON and generic feature hashing.
// Canonical JSON: object keys sorted, numbers rounded to 6 dp, undefined dropped.
// It is the input to blueprint_hash (Doc 04 §8) and must never depend on key insertion order.

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalise(value));
}

function normalise(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map(normalise);
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = normalise(x);
    }
    return out;
  }
  return null;
}

/** Leaf tokens "path=value" of a JSON value; array indices are kept so position matters. */
export function leafTokens(value: unknown, prefix = ''): string[] {
  const out: string[] = [];
  const walk = (v: unknown, p: string) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (typeof v === 'object') for (const k of Object.keys(v as object).sort()) walk((v as Record<string, unknown>)[k], p ? `${p}.${k}` : k);
    else out.push(`${p}=${String(v)}`);
  };
  walk(value, prefix);
  return out;
}

function fnv(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Signed feature hashing into a fixed-length, L2-normalised vector. This is the structural /
 * content embedding used for near-duplicate detection (Doc 04 §8): no model call, deterministic.
 */
export function featureHash(tokens: string[], dims = 768): number[] {
  const v = new Array<number>(dims).fill(0);
  for (const t of tokens) {
    const h = fnv(t, 0x811c9dc5);
    const sign = fnv(t, 0x9747b28c) & 1 ? 1 : -1;
    v[h % dims]! += sign;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => Math.round((x / norm) * 1e6) / 1e6);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
