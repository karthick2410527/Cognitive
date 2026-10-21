// n-back: d′ with log-linear correction, bias c stored separately, lure false alarms as their own class.
import { dPrime, summariseBlock, type ScoringModule } from '@cognimetric/core';

const scoring: ScoringModule = {
  scoreBlock: ({ block, results }) => {
    const s = summariseBlock(block, results);
    const t = s.pairs.filter((p) => p.t.condition === 'target');
    const lure = s.pairs.filter((p) => p.t.condition === 'lure');
    const non = s.pairs.filter((p) => p.t.condition !== 'target');
    const hits = t.filter((p) => p.o === 'hit').length;
    const fas = non.filter((p) => p.o === 'false_alarm').length;
    const { d, c } = dPrime(hits, t.length - hits, fas, non.length - fas);
    const valid = t.length >= 5 && non.length >= 10;
    return {
      valid,
      invalid_reason: valid ? undefined : 'too few targets',
      metric: d,
      accuracy: s.accuracy,
      counts: s.counts,
      derived: {
        d_prime: d,
        bias_c: c,
        hit_rate: t.length ? hits / t.length : null,
        false_alarm_rate: non.length ? fas / non.length : null,
        lure_false_alarm_rate: lure.length ? lure.filter((p) => p.o === 'false_alarm').length / lure.length : null,
      },
    };
  },
};

export default scoring;
