// Shared authoring logic for the three recognition task types. These procedural authors stand
// in for the LLM when the local provider is selected (dev / offline / CI): they emit exactly the
// raw-item JSON the model is asked for (Doc 02 §6.1), and that JSON goes through every gate.
import type { Levers, Rng } from '@cognimetric/core';

export const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : Number(v ?? d));
export const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);

export const POSITIONS: [number, number][] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

export function presentation(levers: Levers, n: number, noun: string, rng: Rng) {
  const random = levers.position_policy === 'random';
  return {
    exposure_ms: Math.round(num(levers.exposure_ms, 5000)),
    inter_stimulus_ms: Math.round(num(levers.inter_stimulus_ms, 4000)),
    position_policy: random ? 'random' : 'fixed_centre',
    positions: Array.from({ length: n }, () => (random ? rng.pick(POSITIONS) : [0, 0])),
    announce: random
      ? `You will see ${n} ${noun}${n === 1 ? '' : 's'}, one at a time, in different places on the screen. Try to remember each one.`
      : `You will see ${n} ${noun}${n === 1 ? '' : 's'}, one at a time, in the middle of the screen. Try to remember each one.`,
  };
}

export function delayPhase(levers: Levers) {
  const filler = str(levers.delay_filler, 'none');
  return { phase: 'delay' as const, duration_ms: Math.round(num(levers.delay_ms, 20000)), filler: filler === 'none' ? null : filler };
}

export function cueFor(levers: Levers, position: number): string | null {
  return levers.retrieval_cue === 'cued' ? `It was number ${position + 1} in the sequence.` : null;
}

export function realisation(levers: Levers): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(levers)) out[k] = v;
  return out;
}
