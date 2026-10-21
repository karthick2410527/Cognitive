// Renders recognition items as an SVG bundle: one SVG per encoded stimulus and per option, so
// option order can be shuffled per administration without re-rendering (Doc 04 §9).
import { glyphAsset, renderObject, renderSpatialGrid, type RendererFn } from '@cognimetric/core';

const render: RendererFn = ({ item, variant, idPrefix }) => {
  const bp = item.blueprint as { material: string; phases: { phase: string; stimuli?: { asset: string; cell?: number }[]; probes?: { stem: string; cue: string | null; options: (string | number)[]; target_asset?: string }[]; presentation?: Record<string, unknown>; duration_ms?: number; filler?: string | null }[] };
  const encode = bp.phases.find((p) => p.phase === 'encode')!;
  const delay = bp.phases.find((p) => p.phase === 'delay')!;
  const retrieve = bp.phases.find((p) => p.phase === 'retrieve')!;
  const spatial = bp.material === 'spatial';
  const [cols, rows] = ((encode.presentation?.grid as number[]) ?? [3, 3]) as [number, number];
  const spec = (id: string) => glyphAsset(id)!.spec;
  return {
    payload: {
      material: bp.material,
      presentation: encode.presentation,
      delay: { duration_ms: delay.duration_ms, filler: delay.filler ?? null },
      encode: encode.stimuli!.map((s, i) => ({
        svg: spatial ? renderSpatialGrid(cols, rows, { index: s.cell!, spec: spec(s.asset) }, null, variant, `${idPrefix}-e${i}`) : renderObject(spec(s.asset), variant, `${idPrefix}-e${i}`),
      })),
      probes: retrieve.probes!.map((p, pi) => ({
        stem: p.stem,
        cue: p.cue,
        target_svg: spatial && p.target_asset ? renderObject(spec(p.target_asset), variant, `${idPrefix}-t${pi}`, 120) : null,
        options: p.options.map((o, oi) =>
          spatial ? renderSpatialGrid(cols, rows, null, Number(o), variant, `${idPrefix}-p${pi}o${oi}`, 120) : renderObject(spec(String(o)), variant, `${idPrefix}-p${pi}o${oi}`, 120),
        ),
      })),
    },
  };
};

export default render;
