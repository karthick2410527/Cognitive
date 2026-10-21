import { createRng, type AuthorFn, type RawItem, type ShapeName } from '@cognimetric/core';

const SHAPES: ShapeName[] = ['circle', 'square', 'star', 'triangle', 'diamond', 'hexagon', 'cross', 'pentagon'];
const PHRASES = [
  (s: string) => `A ${s} will appear in the middle of the screen after a short wait. Press the space bar or tap as soon as you see it.`,
  (s: string) => `Watch the middle of the screen. As soon as the ${s} appears, respond as fast as you can.`,
];

const author: AuthorFn = (req) => {
  const root = createRng(req.seed);
  const out: RawItem[] = [];
  for (let n = 0; n < req.count; n++) {
    const rng = root.fork(`item${n}`);
    const shape = rng.pick(SHAPES);
    out.push({
      task_type: req.taskType.id,
      blueprint: {
        phases: [
          { phase: 'instructions', instruction_text: rng.pick(PHRASES)(shape) },
          { phase: 'practice', trial_rule: { kind: 'simple_rt', trials: req.levers.practice_trials } },
          { phase: 'trials', trial_rule: { kind: 'simple_rt', shape, foreperiod_range_ms: [1000, 3000] } },
        ],
        rule_reminder: `Respond as soon as the ${shape} appears.`,
      },
      answer_key: { kind: 'trial_sequence', value: { rule: 'respond_on_onset' } },
      rationale: 'Every trial requires one response after stimulus onset; responses before onset are anticipations.',
      lever_realisation: { ...req.levers },
      lever_conflict: null,
      content_tags: ['processing_speed', 'simple_rt'],
      text_alternative: 'Respond as soon as a shape appears.',
    });
  }
  return out;
};

export default author;
