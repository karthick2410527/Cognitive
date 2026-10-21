// Cross-session delayed-recall probes (Doc 05 §10). Questions concern details of *today* that
// change day to day; routine, habit-answerable questions are forbidden. No names are requested.
import type { CrossSessionModule } from '@cognimetric/core';

const BANK: Record<'general' | 'specific' | 'multi_detail', string[]> = {
  general: [
    'What was the weather like the first time you went outside today?',
    'What was the last thing you did just before starting this test?',
    'Roughly what time of day was it when you started this test?',
  ],
  specific: [
    'What colour was the top you were wearing while doing this test?',
    'What was the last thing you drank before starting this test?',
    'What object was closest to your left hand while you did this test?',
  ],
  multi_detail: [
    'Describe two things you could see from where you sat during this test.',
    'Describe what you were wearing on your feet and on your upper body during this test.',
    'Name two sounds you could hear while you were doing this test.',
  ],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
const STOP = new Set(['the', 'and', 'was', 'were', 'with', 'that', 'this', 'had', 'have', 'from', 'some', 'very', 'just', 'there', 'they']);

const module: CrossSessionModule = {
  probes: ({ specificity, rng, count }) => rng.sample(BANK[specificity], count).map((question) => ({ question, specificity })),
  match(stored, given) {
    const a = norm(stored);
    const b = new Set(norm(given));
    if (!a.length || !b.size) return { grade: 'absent', score: 0 };
    if (a.join(' ') === [...b].join(' ')) return { grade: 'exact', score: 1 };
    const overlap = a.filter((w) => b.has(w)).length / a.length;
    if (overlap >= 0.6) return { grade: 'semantic', score: 0.75 };
    if (overlap >= 0.25) return { grade: 'partial', score: 0.4 };
    return { grade: 'absent', score: 0 };
  },
};

export default module;
