// Presentation timings, positions, the up-front announcement and the delay length are set by the
// levers, not authored: fill or overwrite them from the levers. Stimuli, probes and keys are untouched.
import type { NormalizerFn } from '@cognimetric/core';
import { POSITIONS } from '../author/common';

const normalize: NormalizerFn = ({ raw, levers }) => {
  const bp = raw.blueprint as { material?: string; phases?: Record<string, any>[] } | undefined;
  const phases = bp?.phases;
  if (!Array.isArray(phases)) return raw;
  const encode = phases.find((p) => p.phase === 'encode');
  const delay = phases.find((p) => p.phase === 'delay');
  const n = Array.isArray(encode?.stimuli) ? encode!.stimuli.length : 0;
  const spatial = (encode?.stimuli ?? []).some((s: { cell?: unknown }) => typeof s?.cell === 'number');
  const material = bp!.material ?? (spatial ? 'spatial' : (encode?.stimuli ?? []).some((s: { word?: unknown }) => typeof s?.word === 'string') ? 'word' : 'image');
  bp!.material = material;
  if (encode) {
    const pres = (encode.presentation ?? {}) as Record<string, unknown>;
    const noun = material === 'word' ? 'word' : 'picture';
    const random = levers.position_policy === 'random';
    encode.presentation = {
      ...pres,
      exposure_ms: Number(levers.exposure_ms ?? pres.exposure_ms ?? 5000),
      inter_stimulus_ms: Number(levers.inter_stimulus_ms ?? pres.inter_stimulus_ms ?? 4000),
      position_policy: spatial ? 'grid' : random ? 'random' : 'fixed_centre',
      ...(spatial ? {} : { positions: Array.isArray(pres.positions) && pres.positions.length === n ? pres.positions : Array.from({ length: n }, (_, i) => (random ? POSITIONS[(i * 5 + 2) % POSITIONS.length] : [0, 0])) }),
      announce: typeof pres.announce === 'string' && pres.announce.length > 10 ? pres.announce
        : spatial ? `You will see ${n} pictures appear one at a time in a grid. Try to remember where each one was.`
        : `You will see ${n} ${noun}${n === 1 ? '' : 's'}, one at a time${random ? ', in different places on the screen' : ', in the middle of the screen'}. Try to remember each one.`,
    };
  }
  if (delay) {
    delay.duration_ms = Number(levers.delay_ms ?? delay.duration_ms ?? 20000);
    const filler = levers.delay_filler === 'none' ? null : levers.delay_filler ?? delay.filler ?? null;
    delay.filler = filler;
  }
  return raw;
};

export default normalize;
