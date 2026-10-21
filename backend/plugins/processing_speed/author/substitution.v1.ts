import { createRng, type AuthorFn, type RawItem } from '@cognimetric/core';

const author: AuthorFn = (req) => {
  const root = createRng(req.seed);
  const out: RawItem[] = [];
  const keySize = Math.round(Number(req.levers.key_size ?? 9));
  const tier = String(req.levers.symbol_discriminability ?? 'high');
  for (let n = 0; n < req.count; n++) {
    const rng = root.fork(`item${n}`);
    const symbols = rng.sample([0, 1, 2, 3, 4, 5, 6, 7, 8], keySize);
    const pairs = symbols.map((s, i) => ({ symbol: s, digit: i + 1 }));
    out.push({
      task_type: req.taskType.id,
      blueprint: {
        phases: [
          { phase: 'instructions', instruction_text: 'Use the key to find the number that goes with the boxed symbol. Press that number. Work as quickly as you can without making mistakes.' },
          { phase: 'practice', trial_rule: { kind: 'substitution', trials: req.levers.practice_trials } },
          { phase: 'trials', trial_rule: { kind: 'substitution', symbol_set: tier, key: pairs, no_immediate_repeats: true } },
        ],
        rule_reminder: 'Press the number that goes with the boxed symbol.',
      },
      answer_key: { kind: 'trial_sequence', value: { rule: 'key_lookup' } },
      rationale: 'Each trial is keyed by the visible symbol-to-digit key; the key never leaves the screen.',
      lever_realisation: { ...req.levers },
      lever_conflict: null,
      content_tags: ['processing_speed', 'substitution', `glyphs_${tier}`],
      text_alternative: 'A key pairs symbols with numbers; enter the number for each symbol in turn.',
    });
  }
  return out;
};

export default author;
