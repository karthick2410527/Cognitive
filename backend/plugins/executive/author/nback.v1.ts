// Procedural author for n_back_block with literacy-free stimuli (shapes or abstract symbols).
import { createRng, type AuthorFn, type RawItem } from '@cognimetric/core';

const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star', 'cross'];

const author: AuthorFn = (req) => {
  const root = createRng(req.seed);
  const out: RawItem[] = [];
  const n = Math.round(Number(req.levers.n ?? 2));
  const back = n === 1 ? 'the one just before it' : `the one ${n} before it`;
  for (let k = 0; k < req.count; k++) {
    const rng = root.fork(`item${k}`);
    const kind = req.modality === 'text' ? 'digits' : req.modality === 'visual' ? rng.pick(['shapes', 'symbols'] as const) : rng.pick(['digits', 'shapes', 'symbols'] as const);
    const shapes = kind === 'shapes';
    const set = kind === 'shapes' ? { type: 'shapes', values: rng.sample(SHAPES, 6) } : kind === 'digits' ? { type: 'digits', values: rng.sample([1, 2, 3, 4, 5, 6, 7, 8, 9], 6) } : { type: 'symbols', set: 'high', values: rng.sample([0, 1, 2, 3, 4, 5, 6, 7, 8], 6) };
    const noun = kind === 'shapes' ? 'Shapes' : kind === 'digits' ? 'Numbers' : 'Symbols';
    out.push({
      task_type: req.taskType.id,
      blueprint: {
        phases: [
          { phase: 'instructions', instruction_text: `${noun} appear one at a time. Press Match when the one on screen is the same as ${back}. Otherwise do nothing.` },
          { phase: 'practice', trial_rule: { kind: 'n_back', trials: req.levers.practice_trials } },
          { phase: 'trials', trial_rule: { kind: 'n_back', stimulus_set: set, target_rate: 0.3 } },
        ],
        rule_reminder: `Match = same as ${n} back`,
      },
      answer_key: { kind: 'trial_sequence', value: { rule: 'n_back_match', n } },
      rationale: `A trial is a target exactly when its stimulus equals the stimulus ${n} positions earlier.`,
      lever_realisation: { ...req.levers },
      lever_conflict: null,
      content_tags: ['executive', 'updating', kind],
      text_alternative: `A sequence of ${noun.toLowerCase()}; respond when the current one matches the one ${n} back.`,
    });
  }
  return out;
};

export default author;
