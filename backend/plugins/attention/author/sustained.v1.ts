// Procedural author for sustained_response_block (SART-style withhold-on-target). The author
// writes the stimulus inventory, instruction text, practice rule and trial rule — never trials.
import { createRng, type AuthorFn, type RawItem, type ShapeName } from '@cognimetric/core';

const SHAPES: ShapeName[] = ['circle', 'square', 'triangle', 'diamond', 'star', 'cross', 'hexagon', 'pentagon'];
const PHRASES = [
  (what: string, t: string) => `${what} will appear one at a time. Press the space bar or tap the button for every one except ${t}. When you see ${t}, do nothing.`,
  (what: string, t: string) => `Watch the ${what.toLowerCase()} that appear one by one. Respond to each of them as quickly as you can, but do not respond to ${t}.`,
  (what: string, t: string) => `${what} will come up one by one. Tap for each one. Do not tap for ${t}.`,
];

const author: AuthorFn = (req) => {
  const root = createRng(req.seed);
  const out: RawItem[] = [];
  for (let n = 0; n < req.count; n++) {
    const rng = root.fork(`item${n}`);
    // Stimulus inventory: a subset of digits, shapes or abstract symbols (5–9 members).
    const kind = req.modality === 'text' ? 'digits' : req.modality === 'visual' ? rng.pick(['shapes', 'symbols'] as const) : rng.pick(['digits', 'digits', 'shapes', 'symbols'] as const);
    const size = 5 + rng.int(5);
    const values: (number | string)[] = kind === 'digits' ? rng.sample([1, 2, 3, 4, 5, 6, 7, 8, 9], size).sort() : kind === 'shapes' ? rng.sample(SHAPES, Math.min(size, SHAPES.length)) : rng.sample([0, 1, 2, 3, 4, 5, 6, 7, 8], size).sort();
    const set = { type: kind, values, ...(kind === 'symbols' ? { set: 'high' } : {}) };
    const target = rng.pick(values);
    const digits = kind === 'digits';
    const tName = digits ? `the number ${target}` : kind === 'shapes' ? `the ${target}` : 'the boxed symbol';
    const phrase = rng.int(PHRASES.length);
    out.push({
      task_type: req.taskType.id,
      blueprint: {
        phases: [
          { phase: 'instructions', instruction_text: PHRASES[phrase]!(digits ? 'Numbers' : kind === 'shapes' ? 'Shapes' : 'Symbols', tName) },
          { phase: 'practice', trial_rule: { kind: 'go_nogo_stream', trials: req.levers.practice_trials, target_rate: 0.25 } },
          { phase: 'trials', trial_rule: { kind: 'go_nogo_stream', stimulus_set: set, target, response_mapping: 'withhold_on_target', max_consecutive_targets: 2, no_target_first: 5 } },
        ],
        rule_reminder: `Respond to everything except ${tName}.`,
      },
      answer_key: { kind: 'trial_sequence', value: { rule: 'withhold_on_target', target } },
      rationale: `Every non-target requires a response and ${tName} requires withholding; the rule is shown on screen throughout.`,
      lever_realisation: { ...req.levers },
      lever_conflict: null,
      content_tags: ['attention', 'sustained', kind],
      text_alternative: `A stream of ${kind}; respond to each one except ${tName}.`,
    });
  }
  return out;
};

export default author;
