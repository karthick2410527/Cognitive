// Procedural author for interference_block: the two literacy-free Stroop analogues (Doc 07 §2.1).
import { createRng, type AuthorFn, type RawItem } from '@cognimetric/core';

const SPATIAL = [
  'An arrow will appear on the left or the right. Press the key for the way the arrow points, not the side it is on.',
  'Look at which way the arrow points and press that key. Ignore which side of the screen the arrow appears on.',
];
const SIZE = [
  'Two numbers appear side by side. Press the key on the side of the number with the larger value, even if it is printed smaller.',
  'Pick the side with the bigger number value. The print size does not matter, only the value.',
];

const author: AuthorFn = (req) => {
  const root = createRng(req.seed);
  const out: RawItem[] = [];
  for (let n = 0; n < req.count; n++) {
    const rng = root.fork(`item${n}`);
    const spatial = req.modality === 'visual' ? true : req.modality === 'text' ? false : rng.chance(0.5);
    const rule = spatial
      ? { kind: 'spatial_stroop', offset: rng.pick([0.6, 0.9]) }
      : { kind: 'size_stroop', min_distance: rng.pick([1, 2]), scales: rng.pick([[0.7, 1.3], [0.8, 1.2]]) };
    out.push({
      task_type: req.taskType.id,
      blueprint: {
        phases: [
          { phase: 'instructions', instruction_text: rng.pick(spatial ? SPATIAL : SIZE) },
          { phase: 'practice', trial_rule: { ...rule, trials: req.levers.practice_trials } },
          { phase: 'trials', trial_rule: rule },
        ],
        rule_reminder: spatial ? "Respond to the arrow's direction, not its side." : 'Choose the larger value, not the larger print.',
      },
      answer_key: { kind: 'trial_sequence', value: { rule: spatial ? 'arrow_direction' : 'larger_value_side' } },
      rationale: spatial ? 'The correct key is always the arrow direction; its side is irrelevant.' : 'The correct key is always the side of the numerically larger digit.',
      lever_realisation: { ...req.levers },
      lever_conflict: null,
      content_tags: ['executive', 'inhibition', spatial ? 'spatial_stroop' : 'size_stroop'],
      text_alternative: spatial ? 'An arrow on one side of the screen; respond to where it points.' : 'Two digits of different print sizes; choose the larger value.',
    });
  }
  return out;
};

export default author;
