// Helpers shared by plugin modules (scoring, block summaries, surface-form heuristics).
// Generic: none of these knows about a particular domain.
import type { AnswerKey, BlockSpec, TrialResult, TrialSpec } from './protocol';
import type { BlockScore, ChoiceScore, ChoiceScoreInput } from './sdk';
import { median, trimRts } from './stats';

/** Choice items: per-probe correctness and the fractional item score u = proportion correct. */
export function scoreChoiceGeneric(input: ChoiceScoreInput): ChoiceScore {
  const key = input.item.answer_key as AnswerKey;
  const keys: number[] = key.kind === 'index' ? [key.value] : key.kind === 'index_per_probe' ? key.value : [];
  const per = keys.map((k, i) => {
    const a = input.answers.find((x) => x.probe_index === i);
    return !!a && a.choice === k;
  });
  const u = per.length ? per.filter(Boolean).length / per.length : 0;
  const rts = input.answers.map((a) => a.rt_ms).filter((x): x is number => x !== null);
  return { u, correct: u === 1, per_probe: per, derived: { accuracy: u, median_rt_ms: rts.length ? median(rts) : null } };
}

export type Outcome = 'hit' | 'miss' | 'false_alarm' | 'correct_rejection' | 'error';

/** Classify a trial: hit (correct response), miss (no response when one was due), false_alarm
 *  (response when withholding was correct), correct_rejection, or error (wrong response id). */
export function outcomeOf(t: TrialSpec, r: TrialResult): Outcome {
  if (t.correct === null) return r.response === null ? 'correct_rejection' : 'false_alarm';
  if (r.response === null) return 'miss';
  return r.response === t.correct ? 'hit' : 'error';
}

export interface BlockSummary {
  pairs: { t: TrialSpec; r: TrialResult; o: Outcome }[];
  counts: BlockScore['counts'];
  accuracy: number;
}

/** Pair results with trial specs; unusable trials are discarded before scoring (Doc 09 §7.5). */
export function summariseBlock(block: BlockSpec, results: TrialResult[]): BlockSummary {
  const byIdx = new Map(block.trials.map((t) => [t.index, t]));
  const all = results.filter((r) => byIdx.has(r.index));
  const usable = all.filter((r) => r.timing_quality !== 'unusable');
  const pairs = usable.map((r) => {
    const t = byIdx.get(r.index)!;
    return { t, r, o: outcomeOf(t, r) };
  });
  const correct = pairs.filter((p) => p.o === 'hit' || p.o === 'correct_rejection').length;
  return {
    pairs,
    counts: {
      trials: all.length,
      usable: usable.length,
      degraded: all.filter((r) => r.timing_quality === 'degraded').length,
      unusable: all.length - usable.length,
    },
    accuracy: pairs.length ? correct / pairs.length : 0,
  };
}

/** Median RT of correct responses, after anticipation/lapse trimming. */
export function correctMedianRt(pairs: BlockSummary['pairs'], filter: (p: BlockSummary['pairs'][number]) => boolean = () => true): number {
  const rts = pairs.filter((p) => p.o === 'hit' && p.r.rt_ms !== null && filter(p)).map((p) => p.r.rt_ms!);
  return median(trimRts(rts).kept);
}

/** Scale trial counts for development time-scaling (flagged on the session; never in production). */
export const scaled = (n: number, timeScale: number, min = 8) => Math.max(min, Math.round(n * timeScale));

// ── Text helpers for structural / bias gates ─────────────────────────────────────────
export function words(s: string): string[] {
  return s.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
}

export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  const m = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, m?.length ?? 1);
}

/** Flesch–Kincaid grade level; used to hold instructions at or below the requested reading level. */
export function readingGrade(text: string): number {
  const sentences = Math.max(1, (text.match(/[.!?]+/g) ?? []).length);
  const ws = words(text);
  if (!ws.length) return 0;
  const syl = ws.reduce((s, w) => s + syllables(w), 0);
  return 0.39 * (ws.length / sentences) + 11.8 * (syl / ws.length) - 15.59;
}

/**
 * Options-only surface heuristics for word options: picks the option that is odd on length,
 * syllable count or initial letter. Used by context-blind solvers for verbal items (Doc 08 §8:
 * "options differing in length or grammatical form in a way that cues the key").
 */
export function surfaceOddness(options: string[], extra?: (w: string) => number): number[] {
  const n = options.length;
  const feats = options.map((w) => [w.length, syllables(w), w.charCodeAt(0), extra ? extra(w) : 0]);
  const score = feats.map((f, i) => {
    let s = 0;
    for (let d = 0; d < f.length; d++) {
      const others = feats.filter((_, j) => j !== i).map((g) => g[d]!);
      const m = others.reduce((a, b) => a + b, 0) / others.length;
      const spread = Math.max(1e-6, Math.max(...others) - Math.min(...others));
      const dev = Math.abs(f[d]! - m);
      if (d === 2) s += others.every((x) => x === others[0]) && f[d] !== others[0] ? 1 : 0; // unique initial
      else s += dev > spread + (d === 3 ? 0.6 : 1) ? 1 : 0;
    }
    return s;
  });
  const best = Math.max(...score);
  if (best === 0) return new Array(n).fill(1 / n);
  const winners = score.map((s) => (s === best ? 1 : 0));
  const w = winners.reduce((a, b) => a + b, 0 as number);
  return winners.map((x) => x / w);
}
