// Procedural author for semantic_association: key shares the stem word's narrow category.
import { createRng, type AuthorFn, type RawItem } from '@cognimetric/core';
import { keyMatches } from './bands';
import { closeTo, distinctBy, surfaceSafe } from './common';

const author: AuthorFn = (req, services) => {
  const lex = services.lexicon!;
  const root = createRng(req.seed);
  const out: RawItem[] = [];
  const L = req.levers;
  const n = Math.round(Number(L.option_count ?? 4));
  const dist = String(L.option_semantic_distance);
  for (let k = 0; k < req.count; k++) {
    const rng = root.fork(`item${k}`);
    let made: { stem: string; options: string[]; key: string } | null = null;
    for (const key of rng.shuffle(lex.all().filter((e) => keyMatches(e, L))).slice(0, 80)) {
      const stems = lex.all().filter((e) => e.subcategory === key.subcategory && e.word !== key.word);
      if (!stems.length) continue;
      const stemWord = rng.pick(stems);
      const tol = dist === 'same_narrow_category' ? 0.7 : 1.3;
      const pool = lex.all().filter((e) => e.word !== stemWord.word && e.word !== key.word && closeTo(key, tol)(e) && (dist === 'unrelated' ? e.category !== key.category : e.category === key.category && e.subcategory !== key.subcategory));
      const ds = distinctBy(rng, pool, (e) => (dist === 'unrelated' ? e.category : e.subcategory) + (dist === 'unrelated' ? '' : e.word), n - 1);
      if (ds.length !== n - 1) continue;
      const options = rng.shuffle([key.word, ...ds.map((e) => e.word)]);
      if (!surfaceSafe(lex, options, key.word)) continue;
      made = { stem: stemWord.word, options, key: key.word };
      break;
    }
    const conflict = made ? null : 'option_semantic_distance';
    if (!made) {
      const any = rng.sample(lex.all(), n + 1).map((e) => e.word);
      made = { stem: any[n]!, options: any.slice(0, n), key: any[0]! };
    }
    out.push({
      task_type: req.taskType.id,
      blueprint: { phases: [{ phase: 'present', stem: `Which word goes best with "${made.stem}"?`, options: made.options, target: made.stem }] },
      answer_key: { kind: 'index', value: made.options.indexOf(made.key) },
      rationale: `"${made.key}" is the same kind of thing as "${made.stem}"; the other options are further away in meaning.`,
      lever_realisation: { ...L },
      lever_conflict: conflict,
      content_tags: ['language', 'semantic_knowledge', 'association'],
      text_alternative: null,
    });
  }
  return out;
};

export default author;
