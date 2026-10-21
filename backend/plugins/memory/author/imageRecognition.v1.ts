// Procedural author for image_recognition_forced_choice. Objects come from the asset registry
// (glyph-pack-v1); foil similarity is taken from the registry's similarity relation, not invented.
import { ASYMMETRIC_SHAPES, createRng, glyphAsset, glyphSimilarity, type AuthorFn, type FillName, type RawItem, type ShapeName } from '@cognimetric/core';
import { cueFor, delayPhase, num, presentation, realisation } from './common';

const SYMMETRIC: ShapeName[] = ['circle', 'square', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star', 'cross'];
const FILLS: FillName[] = ['solid', 'outline', 'light', 'hatched'];
const ROTS = [0, 90, 180, 270];
const id = (shape: ShapeName, fill: FillName, rot: number) => `g1:${shape}:${fill}:${ASYMMETRIC_SHAPES.includes(shape) ? rot : 0}`;

const author: AuthorFn = (req) => {
  const root = createRng(req.seed);
  const items: RawItem[] = [];
  for (let n = 0; n < req.count; n++) {
    const rng = root.fork(`item${n}`);
    const L = req.levers;
    const setSize = Math.max(1, Math.round(num(L.set_size, 4)));
    const optionCount = Math.max(2, Math.round(num(L.option_count, 4)));
    const probeCount = Math.min(setSize, Math.max(1, Math.round(num(L.probe_count, 1))));
    const foil = String(L.foil_similarity);
    let conflict: string | null = null;

    // Probe targets need orientable (asymmetric) shapes for medium/high foils.
    const asym = rng.shuffle(ASYMMETRIC_SHAPES);
    const sym = rng.shuffle(SYMMETRIC);
    const needAsym = foil === 'low' ? 0 : probeCount;
    if (needAsym > asym.length) conflict = 'probe_count';
    const targets = asym.slice(0, Math.min(needAsym, asym.length));
    const rest = rng.shuffle([...asym.slice(targets.length), ...sym]);
    const shapes = [...targets, ...rest].slice(0, setSize);
    if (shapes.length < setSize) conflict = 'set_size';
    const encoded = shapes.map((s) => id(s, rng.pick(FILLS), rng.pick(ROTS)));
    const order = rng.shuffle(encoded.map((_, i) => i));
    const stimuli = order.map((i) => ({ asset: encoded[i]! }));
    const unencoded = [...SYMMETRIC, ...ASYMMETRIC_SHAPES].filter((s) => !shapes.includes(s));

    const probeTargets = rng.shuffle(encoded.slice(0, Math.max(probeCount, 1))).slice(0, probeCount);
    const probes: unknown[] = [];
    const key: number[] = [];
    for (const t of probeTargets) {
      const a = glyphAsset(t)!;
      const { shape, fill, rot } = a.spec;
      let foils: string[] = [];
      if (foil === 'high') {
        foils = ROTS.filter((r) => r !== rot).map((r) => id(shape, fill, r));
      } else if (foil === 'medium') {
        const fi = FILLS.indexOf(fill);
        const ri = ROTS.indexOf(rot);
        foils = [1, 2, 3].map((j) => id(shape, FILLS[(fi + j) % 4]!, ROTS[(ri + j) % 4]!));
      } else {
        foils = rng.shuffle(unencoded).map((s) => id(s, fill, rot));
      }
      foils = rng.shuffle(foils.filter((f) => !encoded.includes(f) && glyphSimilarity(t, f) === foil)).slice(0, optionCount - 1);
      if (foils.length < optionCount - 1) conflict = 'option_count';
      const options = rng.shuffle([t, ...foils]);
      key.push(options.indexOf(t));
      probes.push({ stem: 'Which of these did you see?', options, cue: cueFor(L, order.indexOf(encoded.indexOf(t))) });
    }

    items.push({
      task_type: req.taskType.id,
      blueprint: {
        material: 'image',
        phases: [
          { phase: 'encode', stimuli, presentation: presentation(L, setSize, 'picture', rng) },
          delayPhase(L),
          { phase: 'retrieve', probes },
        ],
      },
      answer_key: { kind: 'index_per_probe', value: key },
      rationale: `Each probe has exactly one option that appeared during encoding; the other options are ${foil}-similarity variants that were never shown.`,
      lever_realisation: realisation(L),
      lever_conflict: conflict,
      content_tags: ['memory', 'recognition', 'visual_objects'],
      text_alternative: `${setSize} abstract shape${setSize === 1 ? '' : 's'} appear one at a time. After a pause you choose, from ${optionCount} shapes, the one you saw.`,
    });
  }
  return items;
};

export default author;
