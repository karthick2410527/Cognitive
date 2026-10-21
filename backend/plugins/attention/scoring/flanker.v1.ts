// Flanker scoring: congruency cost on medians of correct trials, trimmed (Doc 06 §6.2–6.3).
import { correctMedianRt, summariseBlock, type ScoringModule } from '@cognimetric/core';

const scoring: ScoringModule = {
  scoreBlock: ({ block, results }) => {
    const s = summariseBlock(block, results);
    const by = (c: string) => s.pairs.filter((p) => p.t.condition === c);
    const cong = by('congruent');
    const inc = by('incongruent');
    const acc = (xs: typeof cong) => (xs.length ? xs.filter((p) => p.o === 'hit').length / xs.length : NaN);
    const mc = correctMedianRt(cong);
    const mi = correctMedianRt(inc);
    const cost = mi - mc;
    const valid = cong.length >= 10 && inc.length >= 10 && Number.isFinite(cost);
    const postError = s.pairs.filter((_, i) => i > 0 && s.pairs[i - 1]!.o !== 'hit');
    return {
      valid,
      invalid_reason: valid ? undefined : 'too few usable trials per condition',
      metric: cost,
      accuracy: s.accuracy,
      counts: s.counts,
      derived: {
        congruency_cost_ms: cost,
        median_rt_congruent_ms: mc,
        median_rt_incongruent_ms: mi,
        accuracy_congruent: acc(cong),
        accuracy_incongruent: acc(inc),
        post_error_median_rt_ms: correctMedianRt(postError),
        trials_per_condition_min: Math.min(cong.length, inc.length),
      },
    };
  },
};

export default scoring;
