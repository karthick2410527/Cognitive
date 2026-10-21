// L1 is compiled from the manifest, never hand-written (Doc 03 §7): definition → exclusions →
// clinical anchors → permitted task types → levers with meanings and permitted values →
// forbidden patterns, then the brief's prose. The output is hashed and stored in prompt_versions.
import type { Manifest } from '@cognimetric/core';

export function compileL1(m: Manifest, brief: string): string {
  const L: string[] = [];
  L.push(`DOMAIN: ${m.name} (construct id: ${m.plugin_id}, brief v${m.version})`, '');
  L.push('WHAT THIS DOMAIN MEASURES', m.construct.definition, '');
  L.push('WHAT THIS DOMAIN DOES NOT MEASURE — an item that mainly measures any of the', 'following is invalid for this domain, however good it is as a question:');
  for (const x of m.construct.exclusions) L.push(`- ${x}`);
  L.push('', 'CLINICAL ANCHOR', `These items are digital analogues of: ${m.construct.clinical_anchors.join('; ')}.`, 'Stay recognisably within those paradigms. Do not invent new paradigms.', '');
  L.push('PERMITTED TASK TYPES FOR THIS DOMAIN');
  // Freeform task types are written from their own prompt, not this one.
  const layered = m.task_types.filter((t) => t.generation !== 'freeform');
  const leversInUse = new Set(layered.flatMap((t) => t.levers));
  for (const t of layered) {
    if (!t.one_line.trim()) throw new Error(`L1 compile: task type ${t.id} has no brief line`);
    L.push(`- ${t.id} (${t.protocol}): ${t.one_line}`);
  }
  L.push('You will be told which single task type to produce. Produce only that one.', '');
  L.push('DIFFICULTY LEVERS AND THEIR MEANING', 'Difficulty in this domain is controlled only by the levers below. You will be', 'given exact values. Realise them precisely; do not compensate by making the', 'wording harder, the vocabulary rarer, or the instructions less clear.');
  for (const [name, d] of Object.entries(m.difficulty_levers)) {
    if (!leversInUse.has(name)) continue;
    const permitted = d.values ? `permitted values: ${d.values.join(', ')}` : d.range ? `permitted range: ${d.range[0]}–${d.range[1]}` : '';
    L.push(`- ${name} (${d.type}): ${d.meaning}${permitted ? ` ${permitted}` : ''}`);
  }
  L.push('', 'FORBIDDEN PATTERNS IN THIS DOMAIN');
  for (const f of m.prompt.forbidden_patterns) L.push(`- ${f.pattern} — ${f.why}`);
  if (brief.trim()) L.push('', 'AUTHORING NOTES', brief.trim());
  return L.join('\n');
}
