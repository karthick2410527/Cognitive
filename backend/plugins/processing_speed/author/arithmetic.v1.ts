// Procedural author for quick_arithmetic: one-step sums with a short time limit. The operation lever
// sets the size of the numbers and the operation; the time limit carries most of the difficulty.
import { createRng, type AuthorFn, type RawItem, type Rng } from '@cognimetric/core';

const between = (rng: Rng, lo: number, hi: number) => lo + rng.int(hi - lo + 1);

function problem(rng: Rng, op: string): [number, string, number, number] {
  switch (op) {
    case 'add_single': { const a = between(rng, 2, 9), b = between(rng, 2, 9); return [a, '+', b, a + b]; }
    case 'subtract_single': { const a = between(rng, 6, 18), b = between(rng, 2, Math.min(9, a - 1)); return [a, '−', b, a - b]; }
    case 'add_double': { const a = between(rng, 12, 59), b = between(rng, 11, 39); return [a, '+', b, a + b]; }
    case 'multiply_single': { const a = between(rng, 3, 9), b = between(rng, 3, 9); return [a, '×', b, a * b]; }
    default: { const a = between(rng, 41, 99), b = between(rng, 12, a - 10); return [a, '−', b, a - b]; }
  }
}

const author: AuthorFn = (req) => {
  const root = createRng(req.seed);
  const L = req.levers;
  const op = String(L.arithmetic_operation ?? 'add_single');
  const n = Math.round(Number(L.option_count ?? 4));
  const out: RawItem[] = [];
  for (let k = 0; k < req.count; k++) {
    const rng = root.fork(`item${k}`);
    const [a, sign, b, r] = problem(rng, op);
    const opts = new Set<number>([r]);
    for (const d of rng.shuffle([1, -1, 2, -2, 10, -10, 3])) { if (opts.size >= n) break; if (r + d >= 0) opts.add(r + d); }
    const options = rng.shuffle([...opts]).map(String);
    out.push({
      task_type: req.taskType.id,
      blueprint: { phases: [{ phase: 'present', instruction_text: 'Choose the answer as quickly as you can.', stem: `${a} ${sign} ${b} = ?`, options }] },
      answer_key: { kind: 'index', value: options.indexOf(String(r)) },
      rationale: `${a} ${sign} ${b} = ${r}.`,
      lever_realisation: { ...L },
      lever_conflict: null,
      content_tags: ['processing_speed', 'arithmetic'],
      text_alternative: null,
    });
  }
  return out;
};

export default author;
