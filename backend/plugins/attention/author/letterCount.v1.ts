// Procedural author for letter_count: a line of capital letters; count how often the target appears.
// With "similar" distractors the other letters share strokes with the target (E among F, P, R).
import { createRng, type AuthorFn, type RawItem } from '@cognimetric/core';
import { LETTER_GROUPS, between, groupOf } from './textCodes';

const ALL = LETTER_GROUPS.flat();

const author: AuthorFn = (req) => {
  const root = createRng(req.seed);
  const L = req.levers;
  const len = Math.round(Number(L.line_length ?? 20));
  const n = Math.round(Number(L.option_count ?? 4));
  const similar = String(L.letter_similarity) === 'similar';
  const out: RawItem[] = [];
  for (let k = 0; k < req.count; k++) {
    const rng = root.fork(`item${k}`);
    const target = rng.pick(ALL);
    const fill = similar ? groupOf(target).filter((c) => c !== target) : ALL.filter((c) => !groupOf(target).includes(c));
    const count = between(rng, Math.max(2, Math.round(len * 0.12)), Math.max(3, Math.round(len * 0.3)));
    const slots = rng.shuffle(Array.from({ length: len }, (_, i) => i)).slice(0, count);
    const line = Array.from({ length: len }, (_, i) => (slots.includes(i) ? target : rng.pick(fill)));
    const opts = new Set<number>([count]);
    for (const d of rng.shuffle([-2, -1, 1, 2, 3])) { if (opts.size >= n) break; if (count + d >= 1) opts.add(count + d); }
    const options = rng.shuffle([...opts]).map(String);
    out.push({
      task_type: req.taskType.id,
      blueprint: { phases: [{ phase: 'present', instruction_text: 'Count carefully.', stem: `How many times does the letter ${target} appear in this line?`, display: line.join(' '), options }] },
      answer_key: { kind: 'index', value: options.indexOf(String(count)) },
      rationale: `The letter ${target} appears ${count} times.`,
      lever_realisation: { ...L },
      lever_conflict: null,
      content_tags: ['attention', 'sustained', 'counting'],
      text_alternative: null,
    });
  }
  return out;
};

export default author;
