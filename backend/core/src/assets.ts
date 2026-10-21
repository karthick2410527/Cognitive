// Stimulus asset registry (Doc 03 §10, Doc 04 §12) for asset-driven items.
// glyph-pack-v1 is a synthetic, licence-free vector pack: every object is a renderable shape spec
// with a precomputed similarity relation, so foil_similarity is controlled by the registry's
// neighbour graph rather than by the model's imagination. A licensed photographic pack can be added
// later behind the same interface.
import type { FillName, ShapeName, ShapeSpec } from './protocol';
import { ASYMMETRIC_SHAPES } from './svg/primitives';

export const GLYPH_PACK = 'glyph-pack-v1';

export interface GlyphAsset { id: string; spec: ShapeSpec; category: string; locales: string[]; licence: string }

const FILLS: FillName[] = ['solid', 'outline', 'light', 'hatched'];
const SYMMETRIC: ShapeName[] = ['circle', 'square', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star', 'cross'];
const ROTS = [0, 90, 180, 270];

function build(): GlyphAsset[] {
  const out: GlyphAsset[] = [];
  for (const shape of [...SYMMETRIC, ...ASYMMETRIC_SHAPES]) {
    const rots = ASYMMETRIC_SHAPES.includes(shape) ? ROTS : [0];
    for (const fill of FILLS)
      for (const rot of rots)
        out.push({ id: `g1:${shape}:${fill}:${rot}`, spec: { shape, fill, size: 'l', rot }, category: shape, locales: ['en', 'en-IN'], licence: 'generated, CC0' });
  }
  return out;
}

const ASSETS = build();
const BY_ID = new Map(ASSETS.map((a) => [a.id, a]));

export const glyphAssets = (): GlyphAsset[] => ASSETS;
export const glyphAsset = (id: string): GlyphAsset | undefined => BY_ID.get(id);

export type SimilarityClass = 'identical' | 'high' | 'medium' | 'low';

/**
 * low    = different category (shape)            — "apple vs hammer"
 * medium = same category, clearly different exemplar (fill AND orientation differ, or fill
 *          differs on a symmetric shape by two fill steps)
 * high   = same category, minimally different exemplar (exactly one minor attribute differs)
 */
export function glyphSimilarity(a: string, b: string): SimilarityClass {
  const x = BY_ID.get(a);
  const y = BY_ID.get(b);
  if (!x || !y) return 'low';
  if (a === b) return 'identical';
  if (x.spec.shape !== y.spec.shape) return 'low';
  const diffs = (x.spec.fill !== y.spec.fill ? 1 : 0) + (x.spec.rot !== y.spec.rot ? 1 : 0);
  if (diffs >= 2) return 'medium';
  if (x.spec.fill !== y.spec.fill) {
    const steps = Math.abs(FILLS.indexOf(x.spec.fill) - FILLS.indexOf(y.spec.fill));
    return steps >= 2 ? 'medium' : 'high';
  }
  return 'high';
}

export function glyphNeighbours(id: string, cls: SimilarityClass): GlyphAsset[] {
  return ASSETS.filter((a) => glyphSimilarity(id, a.id) === cls);
}
