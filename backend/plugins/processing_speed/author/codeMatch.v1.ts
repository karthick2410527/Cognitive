// Procedural author for code_match: one code is shown; exactly one option is an exact copy, the others
// differ by one swapped pair of neighbouring characters or one changed character.
import { createRng, type AuthorFn, type RawItem, type Rng } from '@cognimetric/core';

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.split('');
const code = (rng: Rng, n: number) => Array.from({ length: n }, () => rng.pick(CHARS)).join('');

function variant(rng: Rng, c: string): string {
  const i = rng.int(c.length - 1);
  if (rng.next() < 0.5 && c[i] !== c[i + 1]) return c.slice(0, i) + c[i + 1] + c[i] + c.slice(i + 2);
  const j = rng.int(c.length);
  return c.slice(0, j) + rng.pick(CHARS.filter((x) => x !== c[j])) + c.slice(j + 1);
}

const author: AuthorFn = (req) => {
  const root = createRng(req.seed);
  const L = req.levers;
  const len = Math.round(Number(L.code_length ?? 6));
  const n = Math.round(Number(L.option_count ?? 4));
  const out: RawItem[] = [];
  for (let k = 0; k < req.count; k++) {
    const rng = root.fork(`item${k}`);
    const target = code(rng, len);
    const opts = new Set<string>([target]);
    while (opts.size < n) opts.add(variant(rng, target));
    const options = rng.shuffle([...opts]);
    out.push({
      task_type: req.taskType.id,
      blueprint: { phases: [{ phase: 'present', instruction_text: 'Find the exact copy of this code.', stem: target, options }] },
      answer_key: { kind: 'index', value: options.indexOf(target) },
      rationale: 'Only one option repeats the code character for character.',
      lever_realisation: { ...L },
      lever_conflict: null,
      content_tags: ['processing_speed', 'checking'],
      text_alternative: null,
    });
  }
  return out;
};

export default author;
