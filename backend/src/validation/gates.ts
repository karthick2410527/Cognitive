// Engine-owned gate logic that is not plugin-specific: structural checks (gate 1), bias & safety
// screens (gate 4), canonicalisation for the duplicate gate (gate 5).
import {
  FORBIDDEN_MODEL_FIELDS, RawItemSchema, canonicalJson, canonicalMatrix, leafTokens, matrixTokens, readingGrade, words,
  type GateIssue, type Levers, type MatrixPuzzle, type MatrixRule, type RawItem, type TaskTypeDef,
} from '@cognimetric/core';

export interface StructuralResult { item: RawItem | null; issues: GateIssue[]; repairable: boolean }

const REQUIRED_PHASES: Record<string, string[]> = {
  single: ['present'],
  encode_delay_retrieve: ['encode', 'delay', 'retrieve'],
  timed_block: ['instructions', 'practice', 'trials'],
  dual_task: ['instructions', 'practice', 'trials'],
  cross_session: [],
};
const META_LEAK = /(\*\*|```|^#|difficulty\s*:|correct answer|this item tests|\bthe answer is\b)/im;
const OPTION_LABEL = /^\s*(?:[A-Ea-e]|[1-5])[).:]\s/;
const gradeNum = (g: string) => Number(g.replace(/\D/g, '')) || 5;

function allStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => allStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => allStrings(x, out));
  return out;
}

/** Gate 1 — structural. Repairable failures go through one repair turn (Doc 02 §6.2). */
export function structural(raw: unknown, tt: TaskTypeDef, levers: Levers, readingLevel: string, requireTextAlternative: boolean): StructuralResult {
  const issues: GateIssue[] = [];
  const parsed = RawItemSchema.safeParse(raw);
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 8)) issues.push({ code: 'schema', path: i.path.join('.'), message: i.message, severity: 'fail' });
    return { item: null, issues, repairable: true };
  }
  const item = parsed.data;
  for (const f of FORBIDDEN_MODEL_FIELDS) if (f in (raw as Record<string, unknown>)) issues.push({ code: 'forbidden_field', path: f, message: `the model must not emit "${f}"`, severity: 'fail' });
  if (item.task_type !== tt.id) issues.push({ code: 'wrong_task_type', path: 'task_type', message: `expected ${tt.id}`, severity: 'fail' });
  const phases = item.blueprint.phases.map((p) => p.phase);
  for (const req of REQUIRED_PHASES[tt.protocol] ?? []) if (!phases.includes(req as never)) issues.push({ code: 'missing_phase', path: 'blueprint.phases', message: `protocol ${tt.protocol} requires phase "${req}"`, severity: 'fail' });

  // Options and keys.
  const key = item.answer_key;
  const optionSets: { path: string; options: unknown[] }[] = [];
  item.blueprint.phases.forEach((p, i) => {
    if (Array.isArray(p.options)) optionSets.push({ path: `blueprint.phases[${i}].options`, options: p.options });
    (p.probes ?? []).forEach((pr, j) => {
      const o = (pr as { options?: unknown[] })?.options;
      if (Array.isArray(o)) optionSets.push({ path: `blueprint.phases[${i}].probes[${j}].options`, options: o });
    });
  });
  if (tt.distractor_policy !== 'fair_tree') {
    for (const s of optionSets) {
      const norm = s.options.map((o) => String(o).trim().toLowerCase());
      if (norm.some((o) => !o)) issues.push({ code: 'empty_option', path: s.path, message: 'empty option', severity: 'fail' });
      if (new Set(norm).size !== norm.length) issues.push({ code: 'duplicate_option', path: s.path, message: 'options must be distinct after normalisation', severity: 'fail' });
      if (typeof levers.option_count === 'number' && s.options.length !== levers.option_count)
        issues.push({ code: 'option_count', path: s.path, message: `has ${s.options.length} options, lever option_count is ${levers.option_count}`, severity: 'fail' });
      if (s.options.some((o) => OPTION_LABEL.test(String(o)))) issues.push({ code: 'option_labels', path: s.path, message: 'options must not carry labels; the renderer adds them', severity: 'fail' });
    }
    if (key.kind === 'index' && optionSets[0] && key.value >= optionSets[0].options.length) issues.push({ code: 'key_out_of_range', path: 'answer_key', message: 'key index out of range', severity: 'fail' });
    if (key.kind === 'index_per_probe') {
      if (key.value.length !== optionSets.length) issues.push({ code: 'key_shape', path: 'answer_key', message: 'one key per probe is required', severity: 'fail' });
      key.value.forEach((k, i) => { if (optionSets[i] && k >= optionSets[i]!.options.length) issues.push({ code: 'key_out_of_range', path: `answer_key.value[${i}]`, message: 'key index out of range', severity: 'fail' }); });
    }
  }

  // Reading level and meta-text leakage.
  const target = gradeNum(readingLevel);
  for (const p of item.blueprint.phases) for (const t of [p.stem, p.instruction_text]) {
    if (!t) continue;
    if (META_LEAK.test(t)) issues.push({ code: 'meta_leakage', path: 'blueprint.phases', message: 'markdown or meta-text in item text', severity: 'fail' });
    if (words(t).length >= 10 && readingGrade(t) > target + 1.5) issues.push({ code: 'reading_level', path: 'blueprint.phases', message: `reading grade ${readingGrade(t).toFixed(1)} above target ${target} + 1`, severity: 'fail' });
  }
  if (allStrings(item.blueprint).some((s) => /<\/?[a-z][^>]*>/i.test(s))) issues.push({ code: 'html', path: 'blueprint', message: 'no HTML in item text', severity: 'fail' });
  if (requireTextAlternative && !item.text_alternative) issues.push({ code: 'text_alternative_missing', path: 'text_alternative', message: 'text_alternative is required for visual items', severity: 'fail' });

  const repairable = issues.length > 0;
  // Non-repairable structural failures: the model said it could not realise a lever, or misreports what it did.
  if (item.lever_conflict) issues.push({ code: 'lever_conflict', path: 'lever_conflict', message: `model could not satisfy ${item.lever_conflict}`, severity: 'fail' });
  for (const [name, want] of Object.entries(levers)) {
    const got = item.lever_realisation[name];
    if (got === undefined) continue;
    if ((typeof got === 'number' || typeof got === 'boolean' || typeof got === 'string') && typeof want !== 'object') {
      const same = typeof want === 'number' && typeof got === 'number' ? Math.abs(got - want) <= Math.max(1e-6, Math.abs(want) * 0.15) : String(got) === String(want) || (typeof got === 'string' && got.length > 24);
      if (!same) issues.push({ code: 'lever_fidelity', path: `lever_realisation.${name}`, message: `realised ${JSON.stringify(got)} for requested ${JSON.stringify(want)}`, severity: 'fail' });
    }
  }
  return { item, issues, repairable: repairable && !issues.some((i) => i.code === 'lever_conflict' || i.code === 'lever_fidelity') };
}

export function leverFidelity(item: RawItem, levers: Levers): number {
  const names = Object.keys(levers);
  if (!names.length) return 1;
  return names.filter((n) => item.lever_realisation[n] !== undefined).length / names.length;
}

// ── Gate 4: bias & safety ────────────────────────────────────────────────────────────
const BLOCK: { code: string; re: RegExp; severity: 'fail' | 'quarantine' }[] = [
  { code: 'trauma', re: /\b(death|dead|die|dying|kill\w*|blood|murder|suicide|abuse|accident|war|weapon|gun|bomb|funeral)\b/i, severity: 'fail' },
  { code: 'religion', re: /\b(god|gods|temple|church|mosque|prayer|pray|hindu|christian|muslim|jesus|allah|bible|quran|diwali|christmas|eid|easter)\b/i, severity: 'fail' },
  { code: 'politics', re: /\b(election|minister|president|government|parliament|political|party leader|vote|voting)\b/i, severity: 'fail' },
  { code: 'sport', re: /\b(cricket|football|soccer|baseball|basketball|tennis|rugby|hockey|olympic)\b/i, severity: 'quarantine' },
  { code: 'currency', re: /(\b(rupees?|dollars?|cents?|pence|nickel|penny|dime|euros?)\b|[$₹€£]\s?\d)/i, severity: 'fail' },
  { code: 'brand', re: /\b(coca-?cola|pepsi|nike|adidas|google|facebook|amazon|samsung|toyota|mcdonald'?s|tata|reliance|infosys)\b/i, severity: 'fail' },
  { code: 'named_person', re: /\b(Mr|Mrs|Ms|Dr|Sri|Smt)\.?\s+[A-Z][a-z]+/, severity: 'quarantine' },
  { code: 'clinical', re: /\b(dementia|alzheimer'?s|stroke|cancer|disease|patient|diagnos\w*|impairment)\b/i, severity: 'fail' },
];
const COLOUR = /\b(red|green|blue|yellow|purple|pink|brown|violet|colou?red|colou?r)\b/i;

export function biasScreen(item: RawItem, tt: TaskTypeDef): GateIssue[] {
  const issues: GateIssue[] = [];
  const text = allStrings({ b: item.blueprint, alt: item.text_alternative }).join(' \n ');
  for (const b of BLOCK) if (b.re.test(text)) issues.push({ code: b.code, path: 'blueprint', message: `blocked content class: ${b.code}`, severity: b.severity });
  const visual = tt.renderer.target === 'svg' || tt.protocol === 'timed_block';
  if (visual && !tt.accessibility.colour_dependent) {
    const instructions = item.blueprint.phases.map((p) => `${p.instruction_text ?? ''} ${p.stem ?? ''}`).join(' ');
    if (COLOUR.test(instructions)) issues.push({ code: 'colour_only', path: 'blueprint', message: 'information may not be carried by colour', severity: 'fail' });
    const colours = ((item.blueprint.puzzle as { alphabet?: { colours?: string[] } })?.alphabet?.colours) ?? ['ink'];
    if (colours.some((c) => c !== 'ink')) issues.push({ code: 'colour_only', path: 'blueprint.puzzle.alphabet.colours', message: 'colour is never load-bearing', severity: 'fail' });
  }
  if (!tt.accessibility.literacy_required) {
    const stemWords = item.blueprint.phases.reduce((s, p) => s + words(p.stem ?? '').length, 0);
    if (stemWords > 14) issues.push({ code: 'literacy_demand', path: 'blueprint.phases', message: 'task type declares literacy_required: false but stems are text-heavy', severity: 'fail' });
  }
  if (/<image|https?:\/\/|data:image|base64/i.test(text)) issues.push({ code: 'image_payload', path: 'blueprint', message: 'the model may not emit image URLs, base64 data or image descriptions', severity: 'fail' });
  return issues;
}

// ── Gate 5: canonical form + tokens for the structural embedding ─────────────────────
function sortOptions(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortOptions);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === 'positions' || k === 'cue') continue; // presentation-only randomisation
      out[k] = k === 'options' && Array.isArray(x) && x.every((o) => typeof o !== 'object') ? [...x].map(String).sort() : sortOptions(x);
    }
    return out;
  }
  return v;
}

export function canonicalForm(item: RawItem, tt: TaskTypeDef, levers: Levers): { canonical: string; tokens: string[] } {
  const bp = item.blueprint as Record<string, unknown>;
  if (tt.distractor_policy === 'fair_tree' && bp.puzzle && bp.rule) {
    const p = bp.puzzle as unknown as MatrixPuzzle;
    const r = bp.rule as unknown as MatrixRule;
    return { canonical: canonicalMatrix(p, r), tokens: matrixTokens(p, r) };
  }
  const core = sortOptions(bp);
  // A timed block's identity includes its levers: the same rule at another lever vector is a different item.
  const canonical = canonicalJson(tt.protocol === 'timed_block' ? { blueprint: core, levers } : core);
  // Near-duplicate tokens cover content, not boilerplate shared by every item of a task type
  // (instructions, rule reminders, encoding announcements, practice rules). For timed blocks the
  // lever vector (rounded to perceptible steps) is content too, mirroring the hash above.
  const content = stripBoilerplate(core);
  const tokens = leafTokens(content).flatMap((t) => [t, ...t.split('=')[1]!.toLowerCase().split(/[^a-z0-9:]+/).filter((w) => w.length > 2).map((w) => `w:${w}`)]);
  if (tt.protocol === 'timed_block') for (const [k, v] of Object.entries(levers)) tokens.push(`lever:${k}=${typeof v === 'number' ? roundLever(v) : String(v)}`, `lever:${k}=${typeof v === 'number' ? roundLever(v) : String(v)}#2`);
  return { canonical, tokens };
}

const BOILERPLATE = new Set(['instruction_text', 'rule_reminder', 'announce', 'presentation']);
function stripBoilerplate(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripBoilerplate).filter((x) => x !== undefined);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.phase === 'practice' || o.phase === 'instructions') return undefined;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) if (!BOILERPLATE.has(k)) out[k] = stripBoilerplate(x);
    return out;
  }
  return v;
}
const roundLever = (v: number) => (Math.abs(v) >= 100 ? Math.round(v / 50) * 50 : Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 50) / 50);
