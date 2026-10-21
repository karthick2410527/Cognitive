// Per-locale lexical service (Doc 03 §10). Loads data/lexicon/<locale>.json; a locale file may
// declare a base locale plus overrides. Items are never shared across locales (Doc 08 §8).
import fs from 'node:fs';
import path from 'node:path';
import type { LexEntry, LexicalService } from '@cognimetric/core';
import { config } from '../config';

type Raw = { locale: string; base?: string; norms_source: string; categories?: Record<string, string>; entries?: [string, string, number, number, number, number, string][]; overrides?: Record<string, Partial<LexEntry>>; excluded?: string[] };

const cache = new Map<string, LexicalService>();

function load(locale: string): { entries: LexEntry[]; source: string } {
  const file = path.join(config.DATA_DIR, 'lexicon', `${locale}.json`);
  if (!fs.existsSync(file)) throw new Error(`no lexicon for locale ${locale}`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Raw;
  if (raw.base) {
    const base = load(raw.base);
    const excluded = new Set(raw.excluded ?? []);
    return {
      entries: base.entries.filter((e) => !excluded.has(e.word)).map((e) => ({ ...e, ...(raw.overrides?.[e.word] ?? {}) })),
      source: `${raw.norms_source} (base: ${raw.base})`,
    };
  }
  const cats = raw.categories ?? {};
  return {
    entries: (raw.entries ?? []).map(([word, subcategory, zipf, aoa, imageability, syllables, gloss]) => ({ word, subcategory, category: cats[subcategory] ?? subcategory, zipf, aoa, imageability, syllables, gloss })),
    source: raw.norms_source,
  };
}

export function lexicon(locale: string): LexicalService {
  const hit = cache.get(locale);
  if (hit) return hit;
  const { entries, source } = load(locale);
  const byWord = new Map(entries.map((e) => [e.word, e]));
  const svc: LexicalService = {
    locale,
    normsSource: source,
    lookup: (w) => byWord.get(w.toLowerCase()),
    all: () => entries,
    categories: () => [...new Set(entries.map((e) => e.category))],
    inCategory: (c) => entries.filter((e) => e.category === c),
    semanticDistance: (a, b) => {
      const x = byWord.get(a);
      const y = byWord.get(b);
      if (!x || !y) return 2;
      return x.subcategory === y.subcategory ? 0 : x.category === y.category ? 1 : 2;
    },
  };
  cache.set(locale, svc);
  return svc;
}

export function servicesFor(locale: string, required: string[]) {
  return required.includes('lexical') ? { lexicon: lexicon(locale) } : {};
}
