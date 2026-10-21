// Procedural author for word_recognition_forced_choice. Words and their semantic relations come
// from the lexical service; foils are matched to the key on length and frequency so the options
// alone do not reveal the key (Doc 02 L0 "item integrity").
import { createRng, surfaceOddness, type AuthorFn, type LexEntry, type RawItem } from '@cognimetric/core';
import { cueFor, delayPhase, num, presentation, realisation } from './common';

const author: AuthorFn = (req, services) => {
  const lex = services.lexicon;
  if (!lex) throw new Error('word_recognition requires the lexical service');
  const root = createRng(req.seed);
  const pool = lex.all().filter((e) => e.zipf >= 4.0 && e.imageability >= 6.0);
  const items: RawItem[] = [];

  for (let n = 0; n < req.count; n++) {
    const rng = root.fork(`item${n}`);
    const L = req.levers;
    const setSize = Math.max(1, Math.round(num(L.set_size, 4)));
    const optionCount = Math.max(2, Math.round(num(L.option_count, 4)));
    const probeCount = Math.min(setSize, Math.max(1, Math.round(num(L.probe_count, 1))));
    const foil = String(L.foil_similarity);
    let conflict: string | null = null;

    // One word per subcategory so same-subcategory foils are never encoded words.
    const bySub = new Map<string, LexEntry[]>();
    for (const e of rng.shuffle(pool)) bySub.set(e.subcategory, [...(bySub.get(e.subcategory) ?? []), e]);
    const subs = rng.shuffle([...bySub.keys()]).slice(0, setSize);
    if (subs.length < setSize) conflict = 'set_size';
    const encoded = subs.map((s) => bySub.get(s)![0]!);
    const encodedWords = new Set(encoded.map((e) => e.word));
    const encodedCats = new Set(encoded.map((e) => e.category));
    const close = (t: LexEntry) => (e: LexEntry) => Math.abs(e.word.length - t.word.length) <= 4 && Math.abs(e.zipf - t.zipf) <= 1.6;
    const candidatesFor = (t: LexEntry) => lex.all().filter((e) => !encodedWords.has(e.word) && e.zipf >= 3.2 && close(t)(e));
    const feasible = (t: LexEntry) => {
      const c = candidatesFor(t);
      const n = foil === 'high' ? c.filter((e) => e.subcategory === t.subcategory).length
        : foil === 'medium' ? c.filter((e) => e.category === t.category && e.subcategory !== t.subcategory).length
        : new Set(c.filter((e) => e.category !== t.category && !encodedCats.has(e.category)).map((e) => e.category)).size;
      return n >= optionCount - 1;
    };
    // Probe the encoded words whose foil pool can realise the requested similarity.
    const ranked = rng.shuffle(encoded).sort((a, b) => Number(feasible(b)) - Number(feasible(a)));
    const probeTargets = ranked.slice(0, probeCount);

    const probes: unknown[] = [];
    const key: number[] = [];
    for (const t of probeTargets) {
      const candidates = candidatesFor(t);
      let best: string[] | null = null;
      for (let attempt = 0; attempt < 30 && !best; attempt++) {
        let foils: LexEntry[] = [];
        if (foil === 'high') foils = rng.shuffle(candidates.filter((e) => e.subcategory === t.subcategory));
        else if (foil === 'medium') {
          const seen = new Set<string>();
          foils = rng.shuffle(candidates.filter((e) => e.category === t.category && e.subcategory !== t.subcategory)).filter((e) => !seen.has(e.subcategory) && (seen.add(e.subcategory), true));
          if (foils.length < optionCount - 1) foils = rng.shuffle(candidates.filter((e) => e.category === t.category && e.subcategory !== t.subcategory));
        } else {
          const seen = new Set<string>();
          foils = rng.shuffle(candidates.filter((e) => e.category !== t.category && !encodedCats.has(e.category))).filter((e) => !seen.has(e.category) && (seen.add(e.category), true));
        }
        const chosen = foils.slice(0, optionCount - 1).map((e) => e.word);
        if (chosen.length < optionCount - 1) break;
        const options = rng.shuffle([t.word, ...chosen]);
        const p = surfaceOddness(options, (w) => lex.lookup(w)?.zipf ?? 0)[options.indexOf(t.word)]!;
        if (p <= 1 / optionCount + 0.08 || attempt === 29) best = options;
      }
      if (!best) {
        conflict = 'foil_similarity';
        best = rng.shuffle([t.word, ...rng.sample(candidates.filter((e) => e.word !== t.word), optionCount - 1).map((e) => e.word)]);
      }
      key.push(best.indexOf(t.word));
      probes.push({ stem: 'Which of these words did you see?', options: best, cue: cueFor(L, encoded.indexOf(t)) });
    }

    items.push({
      task_type: req.taskType.id,
      blueprint: {
        material: 'word',
        phases: [
          { phase: 'encode', stimuli: encoded.map((e) => ({ word: e.word })), presentation: presentation(L, setSize, 'word', rng) },
          delayPhase(L),
          { phase: 'retrieve', probes },
        ],
      },
      answer_key: { kind: 'index_per_probe', value: key },
      rationale: `Each probe's keyed word is the only option shown during encoding; foils are ${foil}-similarity words never shown.`,
      lever_realisation: realisation(L),
      lever_conflict: conflict,
      content_tags: ['memory', 'recognition', 'words'],
      text_alternative: null,
    });
  }
  return items;
};

export default author;
