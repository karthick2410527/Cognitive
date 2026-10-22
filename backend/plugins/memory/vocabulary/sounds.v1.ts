// Prompt vocabulary for audio recognition: the sound-pack-v1 ids and the registry's similarity
// relation, so the model can realise foil_similarity exactly as the solver checks it.
import { SOUND_CATEGORIES, SOUND_PITCHES, type VocabularyFn } from '@cognimetric/core';

const vocabulary: VocabularyFn = ({ levers }) => [
  'ASSETS — sound-pack-v1. A sound id is s1:<sound>:<pitch>, pitch 0 to ' + (SOUND_PITCHES.length - 1) + '.',
  ...Object.entries(SOUND_CATEGORIES).map(([c, fs]) => `Category ${c}: ${fs.join(', ')}.`),
  'Encode each sound at most once per item, and never two pitches of the same sound.',
  'FOIL SIMILARITY, exactly as the solver checks it (compare each foil with the target):',
  '  high   = the same sound at a different pitch.',
  '  medium = a different sound from the same category.',
  '  low    = a sound from a different category.',
  `Requested foil_similarity: ${String(levers.foil_similarity)}. Every foil must be in that class and must not be an encoded sound.`,
  'Stimuli are { "sound": id }; options are sound ids. Never describe a sound in words anywhere in the item.',
].join('\n');

export default vocabulary;
