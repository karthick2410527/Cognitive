// Choice RT: median correct RT; choice cost = choice median − simple-RT median from this session's
// motor baseline, isolating the decision component from motor and device latency (Doc 09 §4).
import { correctMedianRt, median, rtCv, summariseBlock, trimRts, type ScoringModule } from '@cognimetric/core';

const scoring: ScoringModule = {
  scoreBlock: ({ block, results, baseline }) => {
    const s = summariseBlock(block, results);
    const med = correctMedianRt(s.pairs);
    const rts = trimRts(s.pairs.filter((p) => p.o === 'hit' && p.r.rt_ms !== null).map((p) => p.r.rt_ms!)).kept;
    const errors = s.pairs.filter((p) => p.o === 'error').length;
    const valid = rts.length >= 10;
    return {
      valid,
      invalid_reason: valid ? undefined : 'too few correct responses',
      metric: med,
      accuracy: s.accuracy,
      counts: s.counts,
      derived: {
        median_rt_ms: med,
        rt_cv: rtCv(rts),
        error_rate: s.pairs.length ? errors / s.pairs.length : null,
        choice_cost_ms: baseline?.simple_rt_median_ms ? med - baseline.simple_rt_median_ms : null,
        simple_rt_baseline_ms: baseline?.simple_rt_median_ms ?? null,
        median_all_ms: median(rts),
      },
    };
  },
};

export default scoring;
