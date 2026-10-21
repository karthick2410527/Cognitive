// Procedural author for visual_search_block. Distractors differ from the target on exactly one
// feature, chosen by the distractor_similarity lever (shape → pop-out; rotation → serial search).
import { ASYMMETRIC_SHAPES, createRng, type AuthorFn, type FillName, type RawItem, type ShapeName } from '@cognimetric/core';

const OTHER: ShapeName[] = ['circle', 'square', 'triangle', 'diamond', 'hexagon', 'cross'];

const author: AuthorFn = (req) => {
  const root = createRng(req.seed);
  const out: RawItem[] = [];
  for (let n = 0; n < req.count; n++) {
    const rng = root.fork(`item${n}`);
    const sim = String(req.levers.distractor_similarity);
    const shape = rng.pick(ASYMMETRIC_SHAPES);
    const fill: FillName = rng.pick(['solid', 'outline'] as FillName[]);
    const rot = rng.pick([0, 90, 180, 270]);
    const target = { shape, fill, size: 'm', rot };
    let pool: unknown[];
    if (sim === 'shape') pool = rng.sample(OTHER, 2).map((s) => ({ shape: s, fill, size: 'm', rot }));
    else if (sim === 'fill') pool = (['solid', 'outline', 'light', 'hatched'] as FillName[]).filter((f) => f !== fill).slice(0, 2).map((f) => ({ shape, fill: f, size: 'm', rot }));
    else pool = [0, 90, 180, 270].filter((r) => r !== rot).map((r) => ({ shape, fill, size: 'm', rot: r }));
    out.push({
      task_type: req.taskType.id,
      blueprint: {
        phases: [
          { phase: 'instructions', instruction_text: 'Look for the shape shown at the top of the screen. Press Present if it is in the grid and Absent if it is not. Be quick but careful.' },
          { phase: 'practice', trial_rule: { kind: 'search_grid', trials: req.levers.practice_trials } },
          { phase: 'trials', trial_rule: { kind: 'search_grid', grid: [6, 6], target, distractor_pool: pool, target_present_rate: 0.5, max_consecutive_same_response: 3 } },
        ],
        rule_reminder: 'Is this shape in the grid?',
      },
      answer_key: { kind: 'trial_sequence', value: { rule: 'target_present' } },
      rationale: 'Each trial is keyed present exactly when the target appears in the grid; distractors differ from it on one feature only.',
      lever_realisation: { ...req.levers },
      lever_conflict: null,
      content_tags: ['attention', 'selective', 'visual_search'],
      text_alternative: 'A grid of shapes; decide whether a given target shape is present.',
    });
  }
  return out;
};

export default author;
