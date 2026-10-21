import { createRng, type AuthorFn, type RawItem } from '@cognimetric/core';
import { SHAPE_TIERS } from './sets';

const KEYS = ['d', 'f', 'j', 'k'];

const author: AuthorFn = (req) => {
  const root = createRng(req.seed);
  const out: RawItem[] = [];
  const alts = Math.round(Number(req.levers.choice_alternatives ?? 2));
  const tier = String(req.levers.symbol_discriminability ?? 'high');
  for (let n = 0; n < req.count; n++) {
    const rng = root.fork(`item${n}`);
    const keys = alts === 2 ? ['f', 'j'] : KEYS;
    // text = digits as the alternatives; visual = shapes from the discriminability tier.
    const digits = req.modality === 'text' || (req.modality === undefined && rng.chance(0.3));
    const DIGIT_TIERS: Record<string, number[]> = { high: [1, 4, 7, 0], medium: [2, 5, 3, 9], low: [6, 8, 9, 3] };
    const shapes = digits ? [] : rng.sample(SHAPE_TIERS[tier] ?? SHAPE_TIERS.high!, alts);
    const nums = digits ? rng.sample(DIGIT_TIERS[tier] ?? DIGIT_TIERS.high!, alts) : [];
    out.push({
      task_type: req.taskType.id,
      blueprint: {
        phases: [
          { phase: 'instructions', instruction_text: digits ? 'One number will appear at a time. Press the button showing the same number as fast as you can.' : 'One shape will appear at a time. Press the button showing the same shape as fast as you can.' },
          { phase: 'practice', trial_rule: { kind: 'choice_rt', trials: req.levers.practice_trials } },
          { phase: 'trials', trial_rule: { kind: 'choice_rt', stimulus_type: digits ? 'digits' : 'shapes', mapping: digits ? nums.map((d, i) => ({ digit: d, key: keys[i] })) : shapes.map((s, i) => ({ shape: s, key: keys[i] })), max_consecutive_same: 3 } },
        ],
        rule_reminder: digits ? 'Press the matching number.' : 'Press the matching shape.',
      },
      answer_key: { kind: 'trial_sequence', value: { rule: 'matching_shape' } },
      rationale: 'Each trial is keyed by the visible shape-to-button mapping.',
      lever_realisation: { ...req.levers },
      lever_conflict: null,
      content_tags: ['processing_speed', 'choice_rt', digits ? 'digits' : 'shapes'],
      text_alternative: 'A shape appears; press the button showing the same shape.',
    });
  }
  return out;
};

export default author;
