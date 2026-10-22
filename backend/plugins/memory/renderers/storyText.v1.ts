// DOM renderer for story recognition: the story's sentences (opening first) and text-option probes.
import type { RendererFn } from '@cognimetric/core';

const render: RendererFn = ({ item }) => {
  const bp = item.blueprint as { phases: { phase: string; stimuli?: { sentence: string }[]; probes?: { stem: string; cue: string | null; options: string[] }[]; presentation?: Record<string, unknown>; duration_ms?: number; filler?: string | null }[] };
  const encode = bp.phases.find((p) => p.phase === 'encode')!;
  const delay = bp.phases.find((p) => p.phase === 'delay')!;
  const retrieve = bp.phases.find((p) => p.phase === 'retrieve')!;
  const opening = typeof encode.presentation?.opening === 'string' ? [encode.presentation.opening] : [];
  return {
    payload: {
      material: 'story',
      presentation: encode.presentation,
      delay: { duration_ms: delay.duration_ms, filler: delay.filler ?? null },
      encode: [...opening, ...encode.stimuli!.map((s) => s.sentence)].map((text) => ({ text })),
      probes: retrieve.probes!.map((p) => ({ stem: p.stem, cue: p.cue, options: p.options })),
    },
  };
};

export default render;
