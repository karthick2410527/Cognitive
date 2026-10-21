// Procedural author for semantic_odd_one_out (lexicon-driven; every word verifiable).
import { createRng, type AuthorFn, type LexEntry, type RawItem } from '@cognimetric/core';
import { keyMatches } from './bands';
import { closeTo, surfaceSafe } from './common';

const author: AuthorFn = (req, services) => {
  const lex = services.lexicon!;
  const root = createRng(req.seed);
  const out: RawItem[] = [];
  const L = req.levers;
  const n = Math.round(Number(L.option_count ?? 4));
  const dist = String(L.option_semantic_distance);
  for (let k = 0; k < req.count; k++) {
    const rng = root.fork(`item${k}`);
    let made: { options: string[]; key: string; majority: string } | null = null;
    let conflict: string | null = null;
    const keys = rng.shuffle(lex.all().filter((e) => keyMatches(e, L)));
    if (!keys.length) conflict = 'word_frequency';
    for (const key of keys.slice(0, 60)) {
      const near = closeTo(key, 1.2);
      let majority: LexEntry[] = [];
      let label = '';
      // unrelated: majority from one subcategory of another category; otherwise a sibling subcategory.
      const subs = rng.shuffle([...new Set(lex.all().filter((e) => (dist === 'unrelated' ? e.category !== key.category : e.category === key.category && e.subcategory !== key.subcategory)).map((e) => e.subcategory))]);
      for (const s2 of subs) {
        majority = rng.sample(lex.all().filter((e) => e.subcategory === s2 && near(e)), n - 1);
        if (majority.length === n - 1) { label = s2; break; }
      }
      if (majority.length !== n - 1) continue;
      const options = rng.shuffle([key.word, ...majority.map((e) => e.word)]);
      if (!surfaceSafe(lex, options, key.word)) continue;
      made = { options, key: key.word, majority: label };
      break;
    }
    if (!made) {
      conflict = conflict ?? 'option_semantic_distance';
      const any = rng.sample(lex.all(), n).map((e) => e.word);
      made = { options: any, key: any[0]!, majority: 'unknown' };
    }
    out.push({
      task_type: req.taskType.id,
      blueprint: { phases: [{ phase: 'present', stem: 'Which word does not belong with the others?', options: made.options }] },
      answer_key: { kind: 'index', value: made.options.indexOf(made.key) },
      rationale: `All options except "${made.key}" belong to the same group (${made.majority.replace(/_/g, ' ')}); "${made.key}" does not.`,
      lever_realisation: { ...L },
      lever_conflict: conflict,
      content_tags: ['language', 'semantic_knowledge', 'odd_one_out'],
      text_alternative: null,
    });
  }
  return out;
};

export default author;
