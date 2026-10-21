// DOM renderer for word recognition: emits a DOM spec (text only); labelling is added by the client.
import type { RendererFn } from '@cognimetric/core';

const render: RendererFn = ({ item }) => {
  const bp = item.blueprint as { phases: { phase: string; stimuli?: { word: string }[]; probes?: { stem: string; cue: string | null; options: string[] }[]; presentation?: Record<string, unknown>; duration_ms?: number; filler?: string | null }[] };
  const encode = bp.phases.find((p) => p.phase === 'encode')!;
  const delay = bp.phases.find((p) => p.phase === 'delay')!;
  const retrieve = bp.phases.find((p) => p.phase === 'retrieve')!;
  return {
    payload: {
      material: 'word',
      presentation: encode.presentation,
      delay: { duration_ms: delay.duration_ms, filler: delay.filler ?? null },
      encode: encode.stimuli!.map((s) => ({ text: s.word })),
      probes: retrieve.probes!.map((p) => ({ stem: p.stem, cue: p.cue, options: p.options })),
    },
  };
};

export default render;
