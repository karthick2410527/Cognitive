// Procedural author for mismatch_pair: each option is a pair of codes; in all but one option the two
// codes are identical, and in the key they differ by exactly one character.
import { createRng, type AuthorFn, type RawItem, type Rng } from '@cognimetric/core';
import { CODE_CHARS, CONFUSABLE, PAIR_SEP, isConfusable } from './textCodes';

const code = (rng: Rng, n: number) => Array.from({ length: n }, () => rng.pick(CODE_CHARS)).join('');

function alter(rng: Rng, c: string, similar: boolean): string | null {
  for (let tries = 0; tries < 40; tries++) {
    const i = rng.int(c.length);
    const from = c[i]!;
    const pool = similar ? (CONFUSABLE[from] ?? []).filter((x) => CODE_CHARS.includes(x)) : CODE_CHARS.filter((x) => x !== from && !isConfusable(from, x));
    if (!pool.length) continue;
    return c.slice(0, i) + rng.pick(pool) + c.slice(i + 1);
  }
  return null;
}

const author: AuthorFn = (req) => {
  const root = createRng(req.seed);
  const L = req.levers;
  const len = Math.round(Number(L.code_length ?? 6));
  const n = Math.round(Number(L.option_count ?? 4));
  const similar = String(L.difference_confusability) === 'similar';
  const out: RawItem[] = [];
  for (let k = 0; k < req.count; k++) {
    const rng = root.fork(`item${k}`);
    const codes = new Set<string>();
    while (codes.size < n) codes.add(code(rng, len));
    const list = [...codes];
    const keyIdx = rng.int(n);
    const changed = alter(rng, list[keyIdx]!, similar) ?? list[keyIdx]!.split('').reverse().join('');
    const options = list.map((c, i) => `${c}${PAIR_SEP}${i === keyIdx ? changed : c}`);
    out.push({
      task_type: req.taskType.id,
      blueprint: { phases: [{ phase: 'present', instruction_text: 'Each row shows two codes. Look carefully.', stem: 'Which pair does not match exactly?', options }] },
      answer_key: { kind: 'index', value: keyIdx },
      rationale: `In row ${keyIdx + 1} one character differs; every other row shows the same code twice.`,
      lever_realisation: { ...L },
      lever_conflict: null,
      content_tags: ['attention', 'selective', 'checking'],
      text_alternative: null,
    });
  }
  return out;
};

export default author;
