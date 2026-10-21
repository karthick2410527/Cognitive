// Simple RT: median of trimmed RTs, CV, anticipations and lapses (Doc 09 §5.1–5.2).
import { median, rtCv, summariseBlock, trimRts, type ScoringModule } from '@cognimetric/core';

const scoring: ScoringModule = {
  scoreBlock: ({ block, results }) => {
    const s = summariseBlock(block, results);
    const rts = s.pairs.filter((p) => p.r.rt_ms !== null).map((p) => p.r.rt_ms!);
    const t = trimRts(rts);
    const med = median(t.kept);
    const valid = t.kept.length >= 8;
    return {
      valid,
      invalid_reason: valid ? undefined : 'too few usable responses',
      metric: med,
      accuracy: s.accuracy,
      counts: s.counts,
      derived: { median_rt_ms: med, rt_cv: rtCv(t.kept), anticipations: t.anticipations, lapses: t.lapses, omissions: s.pairs.filter((p) => p.o === 'miss').length },
    };
  },
};

export default scoring;
