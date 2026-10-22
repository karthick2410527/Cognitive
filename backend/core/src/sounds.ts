// Sound asset registry for audio recognition (Memory plugin doc §9 "Audio — sounds, not words").
// sound-pack-v1 is synthetic and licence-free: every sound is a named recipe (family) at one of
// four pitches, synthesised by the client with Web Audio, so nothing is downloaded and foil
// similarity is controlled by the registry exactly as glyph-pack-v1 does for pictures.
import type { SimilarityClass } from './assets';

export const SOUND_PACK = 'sound-pack-v1';

/** Families grouped by category: low-similarity foils come from a different category. */
export const SOUND_CATEGORIES: Record<string, string[]> = {
  ringing: ['bell', 'chime', 'doorbell', 'phone'],
  sweep: ['whistle', 'siren', 'drip', 'slide'],
  beat: ['drum', 'knock', 'clap', 'tick'],
  buzz: ['horn', 'buzzer', 'alarm', 'engine'],
};

/** Pitch steps of a minor third: close enough to be "the same sound", far enough to tell apart. */
export const SOUND_PITCHES = [1, 1.19, 1.41, 1.68] as const;

export interface SoundAsset { id: string; family: string; category: string; pitch: number; licence: string }

function build(): SoundAsset[] {
  const out: SoundAsset[] = [];
  for (const [category, families] of Object.entries(SOUND_CATEGORIES))
    for (const family of families)
      for (let p = 0; p < SOUND_PITCHES.length; p++) out.push({ id: `s1:${family}:${p}`, family, category, pitch: p, licence: 'generated, CC0' });
  return out;
}

const SOUNDS = build();
const BY_ID = new Map(SOUNDS.map((s) => [s.id, s]));

export const soundAssets = (): SoundAsset[] => SOUNDS;
export const soundAsset = (id: string): SoundAsset | undefined => BY_ID.get(id);

/**
 * low    = different category            — "bell vs drum"
 * medium = same category, different sound — "bell vs doorbell"
 * high   = same sound at a different pitch — "bell vs a slightly higher bell"
 */
export function soundSimilarity(a: string, b: string): SimilarityClass {
  const x = BY_ID.get(a);
  const y = BY_ID.get(b);
  if (!x || !y) return 'low';
  if (a === b) return 'identical';
  if (x.category !== y.category) return 'low';
  if (x.family !== y.family) return 'medium';
  return 'high';
}
