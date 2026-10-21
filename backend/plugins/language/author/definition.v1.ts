// Procedural author for word_definition_choice. The stem is the lexicon gloss of the key; the
// LLM path writes its own definition, which the solver checks against the gloss.
import { createRng, type AuthorFn, type RawItem } from '@cognimetric/core';
import { DISTANCE, keyMatches } from './bands';
import { closeTo, distinctBy, surfaceSafe } from './common';

const author: AuthorFn = (req, services) => {
  const lex = services.lexicon!;
  const root = createRng(req.seed);
  const out: RawItem[] = [];
  const L = req.levers;
  const n = Math.round(Number(L.option_count ?? 4));
  const dist = String(L.option_semantic_distance);
  const want = dist === 'same_narrow_category' ? 0 : DISTANCE[dist] ?? 2;
  for (let k = 0; k < req.count; k++) {
    const rng = root.fork(`item${k}`);
    let made: { stem: string; options: string[]; key: string } | null = null;
    for (const key of rng.shuffle(lex.all().filter((e) => keyMatches(e, L))).slice(0, 80)) {
      const pool = lex.all().filter((e) => e.word !== key.word && closeTo(key, 1.4)(e) && lex.semanticDistance(key.word, e.word) === want);
      const ds = distinctBy(rng, pool, (e) => (want === 2 ? e.category : e.word), n - 1);
      if (ds.length !== n - 1) continue;
      if (key.gloss.toLowerCase().includes(key.word)) continue;
      const options = rng.shuffle([key.word, ...ds.map((e) => e.word)]);
      if (!surfaceSafe(lex, options, key.word)) continue;
      made = { stem: key.gloss.charAt(0).toUpperCase() + key.gloss.slice(1) + '.', options, key: key.word };
      break;
    }
    const conflict = made ? null : 'option_semantic_distance';
    if (!made) {
      const any = rng.sample(lex.all(), n);
      made = { stem: any[0]!.gloss, options: any.map((e) => e.word), key: any[0]!.word };
    }
    out.push({
      task_type: req.taskType.id,
      blueprint: { phases: [{ phase: 'present', stem: made.stem, options: made.options, instruction_text: 'Which word matches this meaning?' }] },
      answer_key: { kind: 'index', value: made.options.indexOf(made.key) },
      rationale: `The definition describes "${made.key}"; each other option is a different thing.`,
      lever_realisation: { ...L },
      lever_conflict: conflict,
      content_tags: ['language', 'vocabulary', 'definition'],
      text_alternative: null,
    });
  }
  return out;
};

export default author;
