// Substitution throughput: correct substitutions per 90 s, with a 90 % accuracy validity gate
// (Doc 09 §5.3: accuracy is a validity check, not a score), 15 s bucket rates and slope.
import { slope, summariseBlock, type ScoringModule } from '@cognimetric/core';

const scoring: ScoringModule = {
  scoreBlock: ({ block, results }) => {
    const s = summariseBlock(block, results);
    const answered = s.pairs.filter((p) => p.r.response !== null);
    const correct = answered.filter((p) => p.o === 'hit').length;
    const accuracy = answered.length ? correct / answered.length : 0;
    const duration = block.duration_s ?? 90;
    const perNinety = correct * (90 / duration);
    const bucketMs = 15000 * block.time_scale;
    const buckets: number[] = [];
    for (const p of answered) {
      if (p.o !== 'hit') continue;
      const b = Math.floor((p.r.onset_ms + (p.r.rt_ms ?? 0)) / bucketMs);
      buckets[b] = (buckets[b] ?? 0) + 1;
    }
    const filled = Array.from({ length: Math.max(1, Math.round(duration / (15 * block.time_scale))) }, (_, i) => buckets[i] ?? 0);
    const valid = accuracy >= 0.9 && answered.length >= 10;
    return {
      valid,
      invalid_reason: valid ? undefined : accuracy < 0.9 ? 'accuracy_below_90' : 'too few responses',
      metric: perNinety,
      accuracy,
      counts: s.counts,
      derived: { correct_per_90s: perNinety, correct, errors: answered.length - correct, bucket_rates: filled.join(','), within_block_slope: slope(filled.map((_, i) => i), filled) },
    };
  },
};

export default scoring;
