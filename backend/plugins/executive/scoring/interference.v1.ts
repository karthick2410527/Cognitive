// Interference cost (incongruent − congruent median correct RT) plus the error-rate cost; raw
// values are stored alongside (SATO control, Doc 07 §5.3).
import { correctMedianRt, summariseBlock, type ScoringModule } from '@cognimetric/core';

const scoring: ScoringModule = {
  scoreBlock: ({ block, results }) => {
    const s = summariseBlock(block, results);
    const cong = s.pairs.filter((p) => p.t.condition === 'congruent');
    const inc = s.pairs.filter((p) => p.t.condition === 'incongruent');
    const err = (xs: typeof cong) => (xs.length ? xs.filter((p) => p.o !== 'hit').length / xs.length : NaN);
    const cost = correctMedianRt(inc) - correctMedianRt(cong);
    const valid = cong.length >= 10 && inc.length >= 10 && Number.isFinite(cost);
    return {
      valid,
      invalid_reason: valid ? undefined : 'too few usable trials per condition',
      metric: cost,
      accuracy: s.accuracy,
      counts: s.counts,
      derived: {
        interference_cost_ms: cost,
        error_rate_congruent: err(cong),
        error_rate_incongruent: err(inc),
        error_cost: err(inc) - err(cong),
        median_rt_congruent_ms: correctMedianRt(cong),
        median_rt_incongruent_ms: correctMedianRt(inc),
      },
    };
  },
};

export default scoring;
