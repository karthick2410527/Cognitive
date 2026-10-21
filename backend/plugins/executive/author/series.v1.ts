// Procedural author for number_series ("what comes next?") and odd_number_out ("which number does
// not fit?"). Each sequence follows one positional rule family; the solver re-derives it.
import { createRng, type AuthorFn, type RawItem, type Rng } from '@cognimetric/core';
import { fits, type SeriesRule } from '../solvers/seriesFit';

const between = (rng: Rng, lo: number, hi: number) => lo + rng.int(hi - lo + 1);

function sequence(rng: Rng, rule: SeriesRule, n: number): number[] {
  switch (rule) {
    case 'add_constant': { const a = between(rng, 1, 20), d = between(rng, 2, 9); return Array.from({ length: n }, (_, j) => a + d * j); }
    case 'alternating_add': {
      const a = between(rng, 1, 12), p = between(rng, 1, 6), q = p + between(rng, 1, 6);
      return Array.from({ length: n }, (_, j) => a + Math.ceil(j / 2) * p + Math.floor(j / 2) * q);
    }
    case 'multiply': { const r = n > 5 ? 2 : rng.pick([2, 3]), a = between(rng, 1, r === 2 ? 6 : 3); return Array.from({ length: n }, (_, j) => a * r ** j); }
    case 'increasing_step': {
      const a = between(rng, 1, 12), b = between(rng, 1, 4), c = between(rng, 1, 3);
      return Array.from({ length: n }, (_, j) => a + b * j + (c * j * (j - 1)) / 2);
    }
    case 'fibonacci_like': {
      const s = [between(rng, 1, 5)];
      s.push(s[0]! + between(rng, 0, 4));
      while (s.length < n) s.push(s[s.length - 1]! + s[s.length - 2]!);
      return s;
    }
  }
}

const author: AuthorFn = (req) => {
  const root = createRng(req.seed);
  const L = req.levers;
  const rule = String(L.series_rule ?? 'add_constant') as SeriesRule;
  const n = Math.round(Number(L.terms_shown ?? 5));
  const out: RawItem[] = [];
  for (let k = 0; k < req.count; k++) {
    const rng = root.fork(`item${k}`);
    let made: Omit<RawItem, 'task_type' | 'lever_realisation' | 'content_tags' | 'text_alternative'> | null = null;
    for (let tries = 0; tries < 60 && !made; tries++) {
      if (req.taskType.id === 'number_series') {
        const s = sequence(rng, rule, n + 1);
        const shown = s.slice(0, n);
        const pts = shown.map((v, j) => [j, v] as [number, number]);
        const preds = new Set(fits(pts).map((f) => Math.round(f.at(n))));
        if (preds.size !== 1 || !preds.has(s[n]!)) continue;
        const want = Math.round(Number(L.option_count ?? 4));
        const last = shown[n - 1]!, step = last - shown[n - 2]!;
        const opts = new Set<number>([s[n]!]);
        for (const c of rng.shuffle([s[n]! + 1, s[n]! - 1, last + step, s[n]! + step, s[n]! - 2, s[n]! + 2, last * 2, s[n]! + 10])) { if (opts.size >= want) break; if (c > 0) opts.add(c); }
        if (opts.size < want) continue;
        const options = rng.shuffle([...opts]).map(String);
        made = {
          blueprint: { phases: [{ phase: 'present', instruction_text: 'What number comes next?', stem: `${shown.join(', ')}, ?`, options }] },
          answer_key: { kind: 'index', value: options.indexOf(String(s[n])) },
          rationale: `The sequence follows one rule (${rule.replace(/_/g, ' ')}); the next term is ${s[n]}.`,
          lever_conflict: null,
        };
      } else {
        const s = sequence(rng, rule, n);
        const i = between(rng, 1, n - 1);
        const bad = s[i]! + rng.pick([-3, -2, -1, 1, 2, 3]);
        if (bad <= 0 || s.includes(bad)) continue;
        const shown = s.map((v, j) => (j === i ? bad : v));
        // Exactly one term must be the odd one: removing it leaves a rule that predicts something else there.
        const odd = shown.map((v, j) => fits(shown.map((x, y) => [y, x] as [number, number]).filter(([y]) => y !== j)).some((f) => Math.round(f.at(j)) !== v) ? j : -1).filter((j) => j >= 0);
        if (odd.length !== 1 || odd[0] !== i) continue;
        const options = shown.map(String);
        if (new Set(options).size !== options.length) continue;
        made = {
          blueprint: { phases: [{ phase: 'present', instruction_text: 'One number does not follow the pattern. Which one?', stem: shown.join(', '), options }] },
          answer_key: { kind: 'index', value: i },
          rationale: `Every term but ${bad} follows one rule (${rule.replace(/_/g, ' ')}); the rule gives ${s[i]} there.`,
          lever_conflict: null,
        };
      }
    }
    out.push({
      task_type: req.taskType.id,
      ...(made ?? { blueprint: { phases: [{ phase: 'present', instruction_text: 'What number comes next?', stem: '1, 2, 3, ?', options: ['4', '5', '6', '7'] }] }, answer_key: { kind: 'index', value: 0 }, rationale: 'fallback', lever_conflict: 'series_rule' }),
      lever_realisation: { ...L },
      content_tags: ['executive', 'reasoning', 'number_series'],
      text_alternative: null,
    } as RawItem);
  }
  return out;
};

export default author;
