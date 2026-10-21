// Visual-search scoring: RT slope against set size (ms/item) on correct target-present trials.
import { correctMedianRt, slope, summariseBlock, type ScoringModule } from '@cognimetric/core';

const scoring: ScoringModule = {
  scoreBlock: ({ block, results }) => {
    const s = summariseBlock(block, results);
    const sizes = [...new Set(block.trials.map((t) => Number(t.meta?.set_size)))].sort((a, b) => a - b);
    const pres = sizes.map((n) => correctMedianRt(s.pairs, (p) => p.t.meta?.present === true && Number(p.t.meta?.set_size) === n));
    const abs = sizes.map((n) => correctMedianRt(s.pairs, (p) => p.t.meta?.present === false && Number(p.t.meta?.set_size) === n));
    const ok = sizes.map((_, i) => i).filter((i) => Number.isFinite(pres[i]!));
    const presentSlope = slope(ok.map((i) => sizes[i]!), ok.map((i) => pres[i]!));
    const okA = sizes.map((_, i) => i).filter((i) => Number.isFinite(abs[i]!));
    const absentSlope = slope(okA.map((i) => sizes[i]!), okA.map((i) => abs[i]!));
    const valid = ok.length >= 2 && Number.isFinite(presentSlope);
    return {
      valid,
      invalid_reason: valid ? undefined : 'need correct present trials at two or more set sizes',
      metric: presentSlope,
      accuracy: s.accuracy,
      counts: s.counts,
      derived: {
        search_slope_ms_per_item: presentSlope,
        absent_slope_ms_per_item: absentSlope,
        present_absent_slope_ratio: Number.isFinite(absentSlope) && presentSlope ? absentSlope / presentSlope : null,
        intercept_ms: ok.length ? pres[ok[0]!]! - presentSlope * sizes[ok[0]!]! : null,
      },
    };
  },
};

export default scoring;
