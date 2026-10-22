// Options-only solver for gate 3: it never sees the encode phase. If it beats chance by more than
// the tolerance, the options themselves leak the key.
import { attrDistance, glyphAsset, soundSimilarity, surfaceOddness, type ContextBlindFn, type MatrixCell } from '@cognimetric/core';

const SOUND_DISTANCE = { identical: 0, high: 1, medium: 2, low: 3 } as const;
import { cellXY } from '../author/spatialLocation.v1';

function centralityVote(scores: number[]): number[] {
  const min = Math.min(...scores);
  const w = scores.map((s) => (Math.abs(s - min) < 1e-9 ? 1 : 0));
  const t = w.reduce((a, b) => a + b, 0 as number);
  return w.map((x) => x / t);
}

const contextBlind: ContextBlindFn = ({ item, services }) => {
  const bp = item.blueprint as { material?: string; phases: { phase: string; probes?: unknown[]; presentation?: Record<string, unknown> }[] };
  const probes = (bp.phases.find((p) => p.phase === 'retrieve')?.probes ?? []) as { options: (string | number)[] }[];
  const keys = item.answer_key.kind === 'index_per_probe' ? item.answer_key.value : [];
  const per = probes.map((p) => {
    if (bp.material === 'word') return surfaceOddness(p.options.map(String), (w) => services.lexicon?.lookup(w)?.zipf ?? 0);
    // Story options are all values of one kind (all colours, all numbers): a length or rarity cue
    // is the only thing left to exploit.
    if (bp.material === 'story') return surfaceOddness(p.options.map(String), (w) => services.lexicon?.lookup(w)?.zipf ?? 4);
    if (bp.material === 'audio') return centralityVote(p.options.map((a) => p.options.reduce<number>((s, b) => s + SOUND_DISTANCE[soundSimilarity(String(a), String(b))], 0)));
    if (bp.material === 'spatial') {
      const cols = ((bp.phases.find((x) => x.phase === 'encode')?.presentation?.grid as number[]) ?? [3, 3])[0]!;
      const pts = p.options.map((c) => cellXY(Number(c), cols));
      const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length;
      const cy = pts.reduce((s, q) => s + q[1], 0) / pts.length;
      return centralityVote(pts.map(([x, y]) => Math.hypot(x - cx, y - cy)));
    }
    const cells = p.options.map((o) => ({ ...glyphAsset(String(o))!.spec, count: 1 }) as MatrixCell);
    return centralityVote(cells.map((c) => cells.reduce((s, d) => s + attrDistance(c, d), 0)));
  });
  return { per_question: per, key_indices: keys };
};

export default contextBlind;
