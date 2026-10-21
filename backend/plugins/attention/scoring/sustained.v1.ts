// Sustained-attention scoring with mandatory speed–accuracy trade-off control (Doc 06 §6.1):
// the primary score is the commission-error rate residualised on mean RT; raw values are stored.
import { median, rtCv, slope, summariseBlock, trimRts, type ScoringModule } from '@cognimetric/core';

// Provisional regression of commission rate on mean go-RT (faster ⇒ more commissions; Seli et al.
// 2013 report r = 0.77). Coefficients are placeholders until W3 fits them on response data.
const SATO = { intercept: 0.3, per_ms: -0.001, centre_ms: 380 };

const scoring: ScoringModule = {
  scoreBlock: ({ block, results }) => {
    const s = summariseBlock(block, results);
    const targets = s.pairs.filter((p) => p.t.correct === null);
    const nonTargets = s.pairs.filter((p) => p.t.correct !== null);
    const commission = targets.length ? targets.filter((p) => p.o === 'false_alarm').length / targets.length : NaN;
    const omission = nonTargets.length ? nonTargets.filter((p) => p.o === 'miss').length / nonTargets.length : NaN;
    const goRts = nonTargets.filter((p) => p.o === 'hit' && p.r.rt_ms !== null).map((p) => p.r.rt_ms!);
    const trimmed = trimRts(goRts);
    const meanRt = trimmed.kept.reduce((a, b) => a + b, 0) / Math.max(1, trimmed.kept.length);
    const predicted = Math.min(1, Math.max(0, SATO.intercept + SATO.per_ms * (meanRt - SATO.centre_ms)));
    const residual = commission - predicted;
    // Vigilance decrement: slope of RT variability across block quintiles.
    const q = 5;
    const cvs: number[] = [];
    for (let i = 0; i < q; i++) {
      const lo = Math.floor((i * nonTargets.length) / q);
      const hi = Math.floor(((i + 1) * nonTargets.length) / q);
      const rts = nonTargets.slice(lo, hi).filter((p) => p.o === 'hit' && p.r.rt_ms !== null).map((p) => p.r.rt_ms!);
      cvs.push(rts.length > 2 ? rtCv(rts) : NaN);
    }
    const okIdx = cvs.map((c, i) => (Number.isFinite(c) ? i : -1)).filter((i) => i >= 0);
    const valid = targets.length >= 4 && s.counts.usable >= 0.75 * s.counts.trials && trimmed.kept.length >= 10;
    return {
      valid,
      invalid_reason: valid ? undefined : 'too few usable trials or targets',
      metric: residual,
      accuracy: s.accuracy,
      counts: s.counts,
      derived: {
        commission_rate: commission,
        omission_rate: omission,
        mean_rt_ms: meanRt,
        median_rt_ms: median(trimmed.kept),
        rt_cv: rtCv(trimmed.kept),
        residual_commission_rate: residual,
        sato_predicted_commission: predicted,
        vigilance_slope: okIdx.length >= 3 ? slope(okIdx, okIdx.map((i) => cvs[i]!)) : null,
        anticipations: trimmed.anticipations,
        lapses: trimmed.lapses,
      },
    };
  },
};

export default scoring;
