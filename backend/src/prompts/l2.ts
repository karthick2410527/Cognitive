// Layer 2 — the only varying part (Doc 02 §5). Every value that reaches it is engine-generated or
// validated against an enumeration; free text never does (Doc 10 §2.3).
import { LOCALES, READING_LEVELS, type Levers } from '@cognimetric/core';

export const L2_TEMPLATE_VERSION = 'L2_template/2.1.0';
export const L2_TEMPLATE = `ITEM REQUEST
task_type: {{task_type}}
protocol: {{protocol}}
count: {{count}}
locale: {{locale}} reading_level: {{reading_level}}
modality: {{modality}}
{{modality_note}}
allowed_referents: {{referent_classes}}
seed: {{seed}} generator_version: {{prompt_version}}
LEVERS — realise exactly these values:
{{#each levers}}  {{@key}}: {{this}}
{{/each}}
ACCESSIBILITY CONSTRAINTS — the item must satisfy all of these:
{{#each accessibility}}  {{@key}}: {{this}}
{{/each}}
AVOID THESE CONTENT SIGNATURES (short descriptors of items already banked
in this cell; avoid the same stimulus sets and the same rule instances, not
the task type):
{{#each exclusion_signatures}}  - {{this}}
{{/each}}
Return {{count}} item(s) in "items". For each item also return:
  rationale — why the keyed answer is the only correct one (≤ 40 words)
  lever_realisation — map of lever name → how you realised it
  lever_conflict — null, or the name of a lever you could not satisfy`;

export interface L2Input {
  taskType: string;
  protocol: string;
  count: number;
  locale: string;
  readingLevel: string;
  referentClasses: string[];
  seed: number;
  promptVersion: string;
  levers: Levers;
  accessibility: Record<string, string | boolean>;
  exclusionSignatures: string[];
  timedBlock: boolean;
  modality: 'text' | 'visual';
  modalityNote: string | null;
  vocabulary?: string | null;
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9 ,/_:.-]/g, '').slice(0, 80);
const ident = /^[a-z0-9_]+$/;

export function buildL2(x: L2Input): string {
  if (!(LOCALES as readonly string[]).includes(x.locale)) throw new Error(`locale "${x.locale}" is not an allowed enumeration value`);
  if (!(READING_LEVELS as readonly string[]).includes(x.readingLevel)) throw new Error('reading level not allowed');
  if (!ident.test(x.taskType) || !ident.test(x.protocol)) throw new Error('task type / protocol must be identifiers');
  if (x.modality !== 'text' && x.modality !== 'visual') throw new Error('modality must be text or visual');
  for (const r of x.referentClasses) if (!ident.test(r)) throw new Error('referent class must be an identifier');
  const lines = (o: Record<string, unknown>) => Object.entries(o).map(([k, v]) => `  ${k}: ${Array.isArray(v) ? v.join(',') : String(v)}`).join('\n');
  let out = L2_TEMPLATE
    .replace(/{{task_type}}/g, x.taskType)
    .replace(/{{protocol}}/g, x.protocol)
    .replace(/{{count}}/g, String(x.count))
    .replace(/{{locale}}/g, x.locale)
    .replace(/{{modality}}/g, x.modality)
    .replace(/{{modality_note}}\n/g, x.modalityNote ? `MODALITY — ${x.modalityNote.replace(/[^A-Za-z0-9 ,.:;"()\-–_/]/g, '')}\n` : '')
    .replace(/{{reading_level}}/g, x.readingLevel)
    .replace(/{{referent_classes}}/g, x.referentClasses.join(', '))
    .replace(/{{seed}}/g, String(x.seed))
    .replace(/{{prompt_version}}/g, x.promptVersion)
    .replace(/{{#each levers}}[\s\S]*?{{\/each}}/, lines(x.levers))
    .replace(/{{#each accessibility}}[\s\S]*?{{\/each}}/, lines(x.accessibility))
    .replace(/{{#each exclusion_signatures}}[\s\S]*?{{\/each}}/, x.exclusionSignatures.slice(0, 3).map((s) => `  - ${safe(s)}`).join('\n') || '  - (none)');
  if (x.vocabulary)
    out += `\n${x.vocabulary}`;
  if (x.timedBlock)
    out += `\nFor a timed_block you author the stimulus inventory, the instruction text, the practice sequence and the trial sequence generation rule — not the individual trials. The engine expands the rule into trials with the given seed.`;
  return out;
}

/** Parse an L2 request back into its fields (used by the local provider to honour the prompt). */
export function parseL2(text: string): { task_type?: string; count?: number; locale?: string; seed?: number; modality?: string; levers: Record<string, string> } {
  const get = (re: RegExp) => text.match(re)?.[1];
  const levers: Record<string, string> = {};
  const block = text.split('LEVERS — realise exactly these values:')[1]?.split('ACCESSIBILITY')[0] ?? '';
  for (const line of block.split('\n')) {
    const m = line.match(/^\s+([a-z_]+): (.+)$/);
    if (m) levers[m[1]!] = m[2]!.trim();
  }
  return { task_type: get(/task_type: (\S+)/), count: Number(get(/count: (\d+)/)), locale: get(/locale: (\S+)/), seed: Number(get(/seed: (\d+)/)), modality: get(/modality: (text|visual)/), levers };
}
