// DOM renderer for audio recognition: sound ids from sound-pack-v1. The client synthesises each id
// with Web Audio; options are played on request and never labelled with what the sound is.
import type { RendererFn } from '@cognimetric/core';

const render: RendererFn = ({ item }) => {
  const bp = item.blueprint as { phases: { phase: string; stimuli?: { sound: string }[]; probes?: { stem: string; cue: string | null; options: string[] }[]; presentation?: Record<string, unknown>; duration_ms?: number; filler?: string | null }[] };
  const encode = bp.phases.find((p) => p.phase === 'encode')!;
  const delay = bp.phases.find((p) => p.phase === 'delay')!;
  const retrieve = bp.phases.find((p) => p.phase === 'retrieve')!;
  return {
    payload: {
      material: 'audio',
      presentation: encode.presentation,
      delay: { duration_ms: delay.duration_ms, filler: delay.filler ?? null },
      encode: encode.stimuli!.map((s) => ({ sound: s.sound })),
      probes: retrieve.probes!.map((p) => ({ stem: p.stem, cue: p.cue, options: p.options })),
    },
  };
};

export default render;
