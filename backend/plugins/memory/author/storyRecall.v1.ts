// Procedural author for story_recognition_forced_choice (Memory plugin doc §9 "Story — short story
// or sentence, tested on details"). A story is a list of sentences; each sentence carries exactly
// one detail. Retrieval asks about a detail by the thing it belongs to ("What colour was the
// umbrella?") and offers options of the same kind, so an option is wrong only because the story did
// not say it.
//
// Foil similarity for stories:
//   low    = never in the story, and from a different group than the key (red vs blue)
//   medium = never in the story, same group as the key (red vs orange; 5 vs 6)
//   high   = at least one foil appears in the story as a different detail (a binding error:
//            the scarf was red, the umbrella was blue); any other foils are medium.
import { createRng, type AuthorFn, type RawItem, type Rng } from '@cognimetric/core';
import { delayPhase, num, realisation } from './common';

export type DetailKind = 'colour' | 'number' | 'animal' | 'food' | 'vehicle' | 'item' | 'person';

/** Answer values by kind, in groups of four: medium foils come from the key's own group. */
export const DETAIL_GROUPS: Record<DetailKind, string[][]> = {
  colour: [['red', 'orange', 'yellow', 'pink'], ['blue', 'green', 'purple', 'teal'], ['black', 'white', 'grey', 'brown']],
  number: [['two', 'three', 'four', 'five'], ['six', 'seven', 'eight', 'nine'], ['ten', 'eleven', 'twelve', 'fifteen']],
  animal: [['dog', 'cat', 'rabbit', 'parrot'], ['cow', 'goat', 'horse', 'sheep'], ['fox', 'deer', 'owl', 'squirrel']],
  food: [['soup', 'stew', 'curry', 'porridge'], ['bread', 'cake', 'pie', 'biscuits'], ['rice', 'noodles', 'pasta', 'salad']],
  vehicle: [['bus', 'tram', 'train', 'coach'], ['taxi', 'car', 'van', 'lorry'], ['bicycle', 'scooter', 'boat', 'ferry']],
  item: [['keys', 'wallet', 'phone', 'glasses'], ['gloves', 'scarf', 'hat', 'jacket'], ['book', 'map', 'newspaper', 'notebook']],
  person: [['baker', 'butcher', 'grocer', 'florist'], ['nurse', 'doctor', 'dentist', 'chemist'], ['teacher', 'librarian', 'student', 'painter']],
};

/**
 * Sentence templates. `about` is the thing the detail belongs to; it appears in exactly one
 * sentence of a story, and the question names it, so the solver can find the sentence.
 */
interface Template { kind: DetailKind; about: string; sentence: (v: string) => string; question: string }
export const TEMPLATES: Template[] = [
  { kind: 'colour', about: 'umbrella', sentence: (v) => `They took a ${v} umbrella in case of rain.`, question: 'What colour was the umbrella?' },
  { kind: 'colour', about: 'door', sentence: (v) => `The shop had a ${v} door.`, question: 'What colour was the shop door?' },
  { kind: 'colour', about: 'kite', sentence: (v) => `In the park a child was flying a ${v} kite.`, question: 'What colour was the kite?' },
  { kind: 'colour', about: 'mug', sentence: (v) => `Later they made tea in a ${v} mug.`, question: 'What colour was the mug?' },
  { kind: 'number', about: 'apples', sentence: (v) => `At the market they bought ${v} apples.`, question: 'How many apples did they buy?' },
  { kind: 'number', about: 'stamps', sentence: (v) => `At the post office they asked for ${v} stamps.`, question: 'How many stamps did they ask for?' },
  { kind: 'number', about: 'minutes', sentence: (v) => `The queue took ${v} minutes.`, question: 'How many minutes did the queue take?' },
  { kind: 'animal', about: 'gate', sentence: (v) => `On the way, they saw a ${v} by the gate.`, question: 'What animal was by the gate?' },
  { kind: 'food', about: 'lunch', sentence: (v) => `For lunch they had ${v}.`, question: 'What did they have for lunch?' },
  { kind: 'vehicle', about: 'home', sentence: (v) => `They went home by ${v}.`, question: 'How did they get home?' },
  { kind: 'item', about: 'bench', sentence: (v) => `They left their ${v} on a bench and had to go back.`, question: 'What did they leave on the bench?' },
  { kind: 'person', about: 'corner', sentence: (v) => `At the corner they met a ${v} they knew.`, question: 'Who did they meet at the corner?' },
];

const OPENINGS = ['My neighbour had a busy day out.', 'My cousin spent a day in town.', 'The new teacher had a free Saturday.', 'An old friend of mine went out for the day.'];

export const groupOf = (kind: DetailKind, value: string) => DETAIL_GROUPS[kind].findIndex((g) => g.includes(value));
export const templateFor = (about: string) => TEMPLATES.find((t) => t.about === about);

function choosePlan(rng: Rng, setSize: number, foil: string): Template[] {
  // High similarity needs a second detail of the same kind in the story to act as the lure, so the
  // story leads with two colours and two numbers; probes are then drawn from those.
  const pool = rng.shuffle(TEMPLATES);
  if (foil !== 'high') return pool.slice(0, setSize);
  const colours = pool.filter((t) => t.kind === 'colour');
  const numbers = pool.filter((t) => t.kind === 'number');
  const core = [...colours.slice(0, 2), ...numbers.slice(0, 2)];
  return [...core, ...rng.shuffle(pool.filter((t) => !core.includes(t)))].slice(0, setSize);
}

const author: AuthorFn = (req) => {
  const root = createRng(req.seed);
  const items: RawItem[] = [];
  for (let n = 0; n < req.count; n++) {
    const rng = root.fork(`item${n}`);
    const L = req.levers;
    const setSize = Math.max(2, Math.round(num(L.set_size, 4)));
    const optionCount = Math.max(2, Math.round(num(L.option_count, 4)));
    const probeCount = Math.min(setSize, Math.max(1, Math.round(num(L.probe_count, 1))));
    const foil = String(L.foil_similarity);
    let conflict: string | null = null;

    const plan = choosePlan(rng, setSize, foil);
    if (plan.length < setSize) conflict = 'set_size';
    // Story order: same-kind details are spread out, values of one kind are all different.
    const used = new Map<DetailKind, Set<string>>();
    const order = rng.shuffle(plan);
    const details = order.map((t) => {
      const taken = used.get(t.kind) ?? new Set<string>();
      const value = rng.pick(DETAIL_GROUPS[t.kind].flat().filter((v) => !taken.has(v)));
      used.set(t.kind, taken.add(value));
      return { t, value };
    });
    const storyValues = (kind: DetailKind) => details.filter((d) => d.t.kind === kind).map((d) => d.value);

    // Probe details that can realise the requested foil class.
    const canProbe = (d: (typeof details)[number]) => foil !== 'high' || storyValues(d.t.kind).length >= 2;
    const probed = rng.shuffle(details).sort((a, b) => Number(canProbe(b)) - Number(canProbe(a))).slice(0, probeCount);

    const probes: unknown[] = [];
    const key: number[] = [];
    for (const d of probed) {
      const inStory = new Set(storyValues(d.t.kind));
      const g = groupOf(d.t.kind, d.value);
      const sameGroup = rng.shuffle(DETAIL_GROUPS[d.t.kind][g]!.filter((v) => v !== d.value && !inStory.has(v)));
      let foils: string[];
      if (foil === 'high') {
        const lures = rng.shuffle([...inStory].filter((v) => v !== d.value));
        foils = [...lures.slice(0, 1), ...sameGroup].slice(0, optionCount - 1);
        if (!lures.length) conflict = 'foil_similarity';
      } else if (foil === 'medium') {
        foils = sameGroup.slice(0, optionCount - 1);
      } else {
        // One foil per other group where possible, so no two foils pair up against the key.
        const others = DETAIL_GROUPS[d.t.kind].filter((_, i) => i !== g).map((grp) => rng.shuffle(grp.filter((v) => !inStory.has(v))));
        foils = rng.shuffle(others.flatMap((grp, i) => grp.slice(0, i === 0 ? 2 : 1))).slice(0, optionCount - 1);
      }
      if (foils.length < optionCount - 1) conflict = 'option_count';
      const options = rng.shuffle([d.value, ...foils]);
      key.push(options.indexOf(d.value));
      probes.push({ stem: d.t.question, about: d.t.about, options, cue: L.retrieval_cue === 'cued' ? `It was in sentence ${details.indexOf(d) + 2} of the story.` : null });
    }

    const opening = rng.pick(OPENINGS);
    items.push({
      task_type: req.taskType.id,
      blueprint: {
        material: 'story',
        phases: [
          {
            phase: 'encode',
            stimuli: details.map((d) => ({ sentence: d.t.sentence(d.value), about: d.t.about, kind: d.t.kind })),
            presentation: {
              exposure_ms: Math.round(num(L.exposure_ms, 5000)),
              inter_stimulus_ms: 0,
              position_policy: 'fixed_centre',
              opening,
              announce: `You will read a short story of ${setSize + 1} sentences. Read it carefully: afterwards you will answer questions about its details.`,
            },
          },
          delayPhase(L),
          { phase: 'retrieve', probes },
        ],
      },
      answer_key: { kind: 'index_per_probe', value: key },
      rationale: `Each probe's keyed option is the detail the story gives for the thing asked about; the foils are ${foil}-similarity values of the same kind.`,
      lever_realisation: realisation(L),
      lever_conflict: conflict,
      content_tags: ['memory', 'recognition', 'story'],
      text_alternative: null,
    });
  }
  return items;
};

export default author;
