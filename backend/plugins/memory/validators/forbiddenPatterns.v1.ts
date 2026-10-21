// Memory-specific gate extensions: the forbidden patterns of the brief, as code.
import { words, type GateIssue, type ValidatorFn } from '@cognimetric/core';

const validate: ValidatorFn = ({ item }) => {
  const issues: GateIssue[] = [];
  const bp = item.blueprint as { phases: { phase: string; stimuli?: { word?: string }[]; probes?: { stem?: string; options?: unknown[] }[]; presentation?: { announce?: string } }[] };
  const encode = bp.phases.find((p) => p.phase === 'encode');
  const retrieve = bp.phases.find((p) => p.phase === 'retrieve');
  if (!encode?.presentation?.announce)
    issues.push({ code: 'encoding_not_announced', path: 'blueprint.phases.encode.presentation.announce', message: 'Encoding must be announced up front so failure means forgetting, not missing.', severity: 'fail' });
  const encodedWords = new Set((encode?.stimuli ?? []).map((s) => s.word?.toLowerCase()).filter(Boolean));
  for (const [i, p] of (retrieve?.probes ?? []).entries()) {
    const stemWords = words(p.stem ?? '');
    if (stemWords.some((w) => encodedWords.has(w)))
      issues.push({ code: 'stimuli_listed_in_stem', path: `blueprint.phases.retrieve.probes[${i}].stem`, message: 'Listing the encoded stimuli inside the retrieval stem makes the item self-answering.', severity: 'fail' });
    const opts = (p.options ?? []).map((o) => String(o).toLowerCase());
    if (opts.length < 2 || (opts.includes('yes') && opts.includes('no')))
      issues.push({ code: 'yes_no_recognition', path: `blueprint.phases.retrieve.probes[${i}].options`, message: 'Yes/No recognition has a 50 % guess rate; use forced choice.', severity: 'fail' });
    if (new Set(opts).size !== opts.length)
      issues.push({ code: 'duplicate_options', path: `blueprint.phases.retrieve.probes[${i}].options`, message: 'Options must be distinct.', severity: 'fail' });
  }
  return issues;
};

export default validate;
