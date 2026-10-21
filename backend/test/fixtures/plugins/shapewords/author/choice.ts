import { createRng, type AuthorFn } from '@cognimetric/core';

const SHAPES = ['circle', 'square', 'triangle', 'hexagon', 'pentagon', 'diamond', 'star', 'oval'];
const OTHER = ['chair', 'apple', 'river', 'spoon', 'horse', 'kettle', 'glove', 'bridge', 'cloud', 'ladder'];

const author: AuthorFn = (req) => {
  const rng = createRng(req.seed);
  return Array.from({ length: req.count }, () => {
    const n = Number(req.levers.option_count ?? 3);
    const key = rng.pick(SHAPES);
    const options = rng.shuffle([key, ...rng.sample(OTHER, n - 1)]);
    return {
      task_type: req.taskType.id,
      blueprint: { phases: [{ phase: 'present', stem: 'Which word names a shape?', options }] },
      answer_key: { kind: 'index', value: options.indexOf(key) },
      rationale: `${key} is the only shape name.`,
      lever_realisation: { ...req.levers },
      lever_conflict: null,
      content_tags: ['fixture'],
      text_alternative: null,
    };
  });
};
export default author;
export { SHAPES };
