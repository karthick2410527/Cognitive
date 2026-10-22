// Prompt vocabulary for story recognition: the sentence templates and detail values the solver can
// check, grouped so foil similarity can be realised exactly as the solver classifies it.
import type { VocabularyFn } from '@cognimetric/core';
import { DETAIL_GROUPS, TEMPLATES } from '../author/storyRecall.v1';

const vocabulary: VocabularyFn = ({ levers }) => [
  'DETAILS — each story sentence carries exactly one detail; values come from these groups (kind: group | group | group).',
  ...Object.entries(DETAIL_GROUPS).map(([k, gs]) => `${k}: ${gs.map((g) => g.join(', ')).join(' | ')}`),
  'Stimuli are { "sentence", "about", "kind" }; "about" is a word that appears in that sentence only. Each probe has "stem", "about" and options of the same kind.',
  'FOIL SIMILARITY, exactly as the solver checks it:',
  '  high   = at least one foil is a value the story gives for a DIFFERENT detail; other foils from the key\'s group.',
  '  medium = foils never in the story, from the same group as the key.',
  '  low    = foils never in the story, from a different group than the key.',
  `Requested foil_similarity: ${String(levers.foil_similarity)}.`,
  'SENTENCES — use only these, each at most once; the probe stem is the question exactly as written (about | kind | sentence | question):',
  ...TEMPLATES.map((t) => `${t.about} | ${t.kind} | ${t.sentence('{value}')} | ${t.question}`),
].join('\n');

export default vocabulary;
