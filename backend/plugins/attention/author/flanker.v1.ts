// Procedural author for flanker_block: arrows only (no words, no colour).
import { createRng, type AuthorFn, type RawItem } from '@cognimetric/core';

const PHRASES = [
  'Look only at the arrow in the middle. Press the key for the way it points. Ignore the arrows on either side.',
  'A row of arrows will appear. Look at the middle arrow. Press the key for the way it points. Be quick and careful.',
  'Each time, find the middle arrow and press left or right to match where it points. The other arrows do not matter.',
];

const author: AuthorFn = (req) => {
  const root = createRng(req.seed);
  const out: RawItem[] = [];
  for (let n = 0; n < req.count; n++) {
    const rng = root.fork(`item${n}`);
    const flankers = rng.pick([2, 3]);
    const positions = rng.pick([['centre'], ['above', 'below'], ['left', 'right']]);
    const neutral = rng.pick([0, 0.1]);
    out.push({
      task_type: req.taskType.id,
      blueprint: {
        phases: [
          { phase: 'instructions', instruction_text: PHRASES[rng.int(PHRASES.length)]! },
          { phase: 'practice', trial_rule: { kind: 'flanker', trials: req.levers.practice_trials } },
          { phase: 'trials', trial_rule: { kind: 'flanker', flankers_per_side: flankers, positions, neutral_rate: neutral, conditions: ['congruent', 'incongruent'] } },
        ],
        rule_reminder: 'Respond to the middle arrow only.',
      },
      answer_key: { kind: 'trial_sequence', value: { rule: 'centre_direction' } },
      rationale: 'The correct response on every trial is the direction of the centre arrow; flankers carry no response information.',
      lever_realisation: { ...req.levers },
      lever_conflict: null,
      content_tags: ['attention', 'selective', 'arrows'],
      text_alternative: 'A row of arrows; respond to the direction of the middle arrow.',
    });
  }
  return out;
};

export default author;
