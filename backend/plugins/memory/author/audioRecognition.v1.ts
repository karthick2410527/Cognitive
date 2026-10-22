// Procedural author for audio_recognition_forced_choice (Memory plugin doc §9 "Audio — sounds, not
// words"). Sounds come from the sound registry (sound-pack-v1); foil similarity is the registry's
// relation: low = another category, medium = another sound of the same category, high = the same
// sound at another pitch. Good for low-literacy or vision-impaired users.
import { createRng, SOUND_CATEGORIES, SOUND_PITCHES, soundAsset, soundSimilarity, type AuthorFn, type RawItem } from '@cognimetric/core';
import { cueFor, delayPhase, num, realisation } from './common';

const FAMILIES = Object.values(SOUND_CATEGORIES).flat();
const sid = (family: string, pitch: number) => `s1:${family}:${pitch}`;
const catOf = (family: string) => Object.keys(SOUND_CATEGORIES).find((c) => SOUND_CATEGORIES[c]!.includes(family))!;

const author: AuthorFn = (req) => {
  const root = createRng(req.seed);
  const items: RawItem[] = [];
  for (let n = 0; n < req.count; n++) {
    const rng = root.fork(`item${n}`);
    const L = req.levers;
    const setSize = Math.max(1, Math.round(num(L.set_size, 3)));
    const optionCount = Math.max(2, Math.round(num(L.option_count, 3)));
    const probeCount = Math.min(setSize, Math.max(1, Math.round(num(L.probe_count, 1))));
    const foil = String(L.foil_similarity);
    let conflict: string | null = null;

    // One sound per family, so a same-family foil is never an encoded sound. Probe targets come from
    // different categories and the other sounds avoid those categories where possible, which
    // leaves same-category families free to serve as medium foils.
    const cats = rng.shuffle(Object.keys(SOUND_CATEGORIES));
    const targetFamilies = cats.slice(0, probeCount).map((c) => rng.pick(SOUND_CATEGORIES[c]!));
    const targetCats = new Set(cats.slice(0, probeCount));
    const others = rng.shuffle(FAMILIES.filter((f) => !targetFamilies.includes(f)))
      .sort((a, b) => Number(targetCats.has(catOf(a))) - Number(targetCats.has(catOf(b))));
    const families = rng.shuffle([...targetFamilies, ...others.slice(0, setSize - targetFamilies.length)]);
    if (families.length < setSize || targetFamilies.length < probeCount) conflict = 'set_size';
    const encoded = families.map((f) => sid(f, rng.int(SOUND_PITCHES.length)));
    const encodedFamilies = new Set(families);

    const probeTargets = rng.shuffle(encoded.filter((s) => targetFamilies.includes(soundAsset(s)!.family)));
    const probes: unknown[] = [];
    const key: number[] = [];
    for (const t of probeTargets) {
      const a = soundAsset(t)!;
      let pool: string[];
      if (foil === 'high') pool = SOUND_PITCHES.map((_, p) => sid(a.family, p));
      else if (foil === 'medium') pool = SOUND_CATEGORIES[a.category]!.filter((f) => !encodedFamilies.has(f)).map((f) => sid(f, rng.int(SOUND_PITCHES.length)));
      else pool = FAMILIES.filter((f) => !encodedFamilies.has(f)).map((f) => sid(f, a.pitch));
      // At most one foil per family outside 'high', so no two options are the same sound.
      const seen = new Set<string>();
      const foils = rng.shuffle(pool.filter((f) => f !== t && !encoded.includes(f) && soundSimilarity(t, f) === foil))
        .filter((f) => foil === 'high' || (!seen.has(soundAsset(f)!.family) && (seen.add(soundAsset(f)!.family), true)))
        .slice(0, optionCount - 1);
      if (foils.length < optionCount - 1) conflict = 'option_count';
      const options = rng.shuffle([t, ...foils]);
      key.push(options.indexOf(t));
      probes.push({ stem: 'Which of these sounds did you hear?', options, cue: cueFor(L, encoded.indexOf(t)) });
    }

    items.push({
      task_type: req.taskType.id,
      blueprint: {
        material: 'audio',
        phases: [
          {
            phase: 'encode',
            stimuli: encoded.map((s) => ({ sound: s })),
            presentation: {
              exposure_ms: Math.round(num(L.exposure_ms, 2500)),
              inter_stimulus_ms: Math.round(num(L.inter_stimulus_ms, 1500)),
              position_policy: 'fixed_centre',
              announce: `You will hear ${setSize} sound${setSize === 1 ? '' : 's'}, one at a time. Listen carefully and try to remember each one.`,
            },
          },
          delayPhase(L),
          { phase: 'retrieve', probes },
        ],
      },
      answer_key: { kind: 'index_per_probe', value: key },
      rationale: `Each probe has exactly one option that was played during encoding; the others are ${foil}-similarity sounds that were never played.`,
      lever_realisation: realisation(L),
      lever_conflict: conflict,
      content_tags: ['memory', 'recognition', 'sounds'],
      text_alternative: null,
    });
  }
  return items;
};

export default author;
