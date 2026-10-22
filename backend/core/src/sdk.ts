// Plugin SDK: the manifest schema (Doc 03 §3) and the nine lifecycle hooks (Doc 03 §4).
// The engine depends only on these interfaces — never on a specific plugin.
import { z } from 'zod';
import { AccessibilitySchema, PROTOCOLS } from './protocol';
import type { BlockSpec, Levers, RawItem, TrialResult, Variant } from './protocol';
import type { Rng } from './prng';

// ── Manifest ──────────────────────────────────────────────────────────────────────────
const LeverDefSchema = z.object({
  type: z.enum(['ordinal', 'enum', 'continuous', 'boolean', 'set']),
  values: z.array(z.union([z.number(), z.string(), z.boolean()])).optional(),
  range: z.tuple([z.number(), z.number()]).optional(),
  meaning: z.string().min(1),
  direction: z.enum(['up_is_harder', 'down_is_harder', 'nominal']),
  monotonic: z.boolean().default(true),
  research: z.string().min(1), // research.md anchor justifying the lever (Doc 03 §12 criterion 4)
});
export type LeverDef = z.infer<typeof LeverDefSchema>;

const ModuleRef = z.string().regex(/^[a-z_]+\/[A-Za-z0-9_.-]+$/);

const BlockNormSchema = z.object({
  metric: z.string(),
  mu: z.number(),
  sigma: z.number().positive(),
  direction: z.enum(['higher_is_better', 'lower_is_better']),
  difference_score: z.boolean().default(false),
  provisional: z.boolean().default(true),
});
export type BlockNorm = z.infer<typeof BlockNormSchema>;

const TaskTypeSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  one_line: z.string().min(1),
  protocol: z.enum(PROTOCOLS),
  renderer: z.object({ target: z.enum(['dom', 'svg', 'scene']), module: ModuleRef.nullable() }),
  author: ModuleRef.nullable(), // procedural author used by the local provider (dev / offline)
  solver: ModuleRef.nullable(), // null ⇒ auto_promote must be false (Doc 03 §4)
  context_blind_solver: ModuleRef.nullable(),
  scoring: ModuleRef,
  expander: ModuleRef.nullable().default(null), // timed_block: trial_rule + seed → trials
  validators: z.array(ModuleRef).default([]),
  response_mode: z.enum(['choice', 'multi_select', 'timed_block', 'free_text']),
  levers: z.array(z.string()).min(1),
  accessibility: AccessibilitySchema,
  accessible_substitute: z.string().nullable().default(null),
  component: z.string().nullable().default(null), // report sub-score (e.g. inhibition)
  distractor_policy: z.enum(['model', 'fair_tree']).default('model'),
  default_time_limit_ms: z.record(z.number()).default({}),
  block_norm: BlockNormSchema.nullable().default(null),
  // Presentation modality (text = words / numerals; visual = figures, shapes, pictures, grids).
  // A task type that supports both says how to read the realised modality off its blueprint.
  modalities: z.array(z.enum(['text', 'visual'])).min(1),
  modality_from: z.object({ phase: z.string(), field: z.string(), map: z.record(z.enum(['text', 'visual'])) }).nullable().default(null),
  modality_notes: z.record(z.string()).default({}),
  // Optional prompt-vocabulary module: the words a lexicon-verified item may use, and which of them
  // satisfy the current levers for the keyed answer (rendered into L2).
  vocabulary: ModuleRef.nullable().default(null),
  // Optional normaliser: fills fields the engine owns from the levers (timings, announcements)
  // before validation. It must not change content: stimuli, options, rules or the key.
  normalizer: ModuleRef.nullable().default(null),
  weight: z.number().min(0).max(1),
  min_total_duration_s: z.number().optional(),
  // How items are written: 'layered' = the four-layer prompt with this task type's author/solver;
  // 'freeform' = the free-form written-question prompt (the model picks the question format), with the
  // answer key confirmed by a second, independent model call. Freeform types need no exemplars.
  generation: z.enum(['layered', 'freeform']).default('layered'),
});
export type TaskTypeDef = z.infer<typeof TaskTypeSchema>;

export const ManifestSchema = z.object({
  plugin_id: z.string().regex(/^[a-z_]+$/),
  name: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  engine_range: z.string(),
  status: z.enum(['experimental', 'beta', 'stable']),
  auto_promote: z.boolean(),
  construct: z.object({
    definition: z.string().min(20),
    exclusions: z.array(z.string()).min(1),
    clinical_anchors: z.array(z.string()).min(1),
    references: z.array(z.string()).default([]),
  }),
  dimensions: z.array(z.string()).min(1),
  loading: z.record(z.number()),
  task_type_loadings: z.record(z.record(z.number())).default({}),
  prior: z.object({ a: z.number().positive(), b_range: z.tuple([z.number(), z.number()]).default([-3, 3]) }),
  lever_model: z.string().nullable().default(null),
  min_items_for_theta: z.number().int().default(2),
  target_se: z.number().positive().default(0.32),
  task_types: z.array(TaskTypeSchema).min(1),
  difficulty_levers: z.record(LeverDefSchema),
  lever_policy: z.object({
    kind: z.literal('anchored_interpolation'),
    // Per task type (or "*" for all task types), θ anchor → full lever vector.
    anchors: z.record(z.record(z.record(z.union([z.number(), z.string(), z.boolean(), z.array(z.union([z.number(), z.string()]))])))),
    jitter: z.record(z.number()).default({}),
  }),
  prompt: z.object({
    brief: z.string(),
    forbidden_patterns: z.array(z.object({ pattern: z.string(), why: z.string() })).min(1),
    referent_classes: z.array(z.string()).min(1),
    thinking: z.enum(['minimal', 'low', 'medium', 'high']).default('low'),
    reading_level: z.string().default('grade_5'),
  }),
  context_blind_tolerance_pp: z.number().default(8),
  scoring: z.object({
    primary: z.string(),
    derived: z.array(z.string()).default([]),
    sato_control: z.boolean(),
    report_label: z.string(),
    report_blurb: z.string(),
    report_caveat: z.string().nullable().default(null),
    report_components: z.array(z.string()).default([]),
    demographic_adjustment: z.enum(['none', 'transparent']).default('none'),
  }),
  cross_session: z
    .object({
      enabled: z.boolean(),
      task_type: z.string(),
      delay_days_range: z.tuple([z.number(), z.number()]),
      max_open_probes: z.number().int(),
      module: ModuleRef,
    })
    .nullable()
    .default(null),
  mandatory_task_types: z.array(z.string()).default([]),
  // Where the domain's first-block questions go: 'last' puts them after every other domain's
  // (e.g. the most demanding timed tasks), and lists the domain last.
  session_position: z.enum(['normal', 'last']).default('normal'),
  requires_services: z.array(z.enum(['lexical', 'semantic_embedding', 'asset_registry', 'timing_harness', 'trial_sequencer', 'glyph_assets'])).default([]),
  locale_isolated: z.boolean().default(false),
  bank: z.object({
    k_min_per_cell: z.number().int().positive(),
    k_fresh_per_cell: z.number().int().nonnegative().default(10),
    b_band_width: z.number().positive(),
    batch_size: z.number().int().positive(),
    locales: z.array(z.string()).min(1),
  }),
});
export type Manifest = z.infer<typeof ManifestSchema>;

// ── Shared services handed to plugins (Doc 03 §10) ───────────────────────────────────
export interface LexEntry {
  word: string;
  category: string; // e.g. animal
  subcategory: string; // e.g. farm_animal
  zipf: number;
  aoa: number;
  imageability: number; // 1–7
  syllables: number;
  gloss: string;
}

export interface LexicalService {
  locale: string;
  lookup(word: string): LexEntry | undefined;
  all(): LexEntry[];
  categories(): string[];
  inCategory(category: string): LexEntry[];
  /** 0 = same subcategory, 1 = same category, 2 = different category */
  semanticDistance(a: string, b: string): number;
  normsSource: string;
}

export interface ServiceBag {
  lexicon?: LexicalService;
}

// ── Hook contracts ───────────────────────────────────────────────────────────────────
export type Modality = 'text' | 'visual';

export interface AuthorRequest {
  taskType: TaskTypeDef;
  modality?: Modality;
  levers: Levers;
  count: number;
  seed: number;
  locale: string;
  readingLevel: string;
  exclusionSignatures: string[];
}

export type AuthorFn = (req: AuthorRequest, services: ServiceBag) => RawItem[];

export type SolverVerdictCode = 'key_confirmed' | 'key_mismatch' | 'multiple_solutions' | 'no_solution' | 'no_rule' | 'contradictory_rule' | 'not_solvable_by_rule' | 'lever_mismatch';

export interface SolverVerdict {
  verdict: SolverVerdictCode;
  derived_key?: unknown;
  detail?: string;
}

export interface SolverInput { item: RawItem; levers: Levers; services: ServiceBag; manifest: Manifest; taskType: TaskTypeDef; modality?: Modality }
export type SolverFn = (input: SolverInput) => SolverVerdict;

/** Returns P(option is chosen) per option for each probe/question, from options alone. */
export type ContextBlindFn = (input: SolverInput) => { per_question: number[][]; key_indices: number[] };

export interface GateIssue { code: string; path: string; message: string; severity: 'fail' | 'warn' | 'quarantine' }
export type ValidatorFn = (input: SolverInput) => GateIssue[];

export interface RenderOutput {
  /** Rendered payload stored in item_renderings.payload (SVG bundle JSON or DOM spec JSON). */
  payload: unknown;
}
export type RendererFn = (input: { item: RawItem; levers: Levers; seed: number; variant: Variant; idPrefix: string }) => RenderOutput;

export interface ExpandInput { item: RawItem; levers: Levers; seed: number; rng: Rng; timeScale: number }
export type ExpanderFn = (input: ExpandInput) => BlockSpec;

/** Scoring for choice-style items: one call per administration with all probe responses. */
export interface ChoiceScoreInput { item: RawItem; levers: Levers; answers: { probe_index: number; choice: number | null; rt_ms: number | null }[] }
export interface ChoiceScore { u: number; correct: boolean; per_probe: boolean[]; derived: Record<string, number | string | null> }

export interface BlockScoreInput { block: BlockSpec; levers: Levers; results: TrialResult[]; baseline?: { simple_rt_median_ms?: number } }
export interface BlockScore {
  valid: boolean;
  invalid_reason?: string;
  metric: number; // compared with block_norm.mu / sigma to give a θ-scale performance
  derived: Record<string, number | string | null>;
  accuracy: number;
  counts: { trials: number; usable: number; degraded: number; unusable: number };
}

export interface ScoringModule {
  scoreChoice?: (input: ChoiceScoreInput) => ChoiceScore;
  scoreBlock?: (input: BlockScoreInput) => BlockScore;
}

export interface CrossSessionModule {
  /** Probe questions about the present day; must concern things that change daily (Doc 05 §10). */
  probes(input: { specificity: 'general' | 'specific' | 'multi_detail'; rng: Rng; count: number }): { question: string; specificity: string }[];
  /** Graded matcher used when no model is available: exact / semantic / partial / absent. */
  match(stored: string, given: string): { grade: 'exact' | 'semantic' | 'partial' | 'absent'; score: number };
}

export type NormalizerFn = (input: { raw: Record<string, unknown>; levers: Levers }) => Record<string, unknown>;

export type VocabularyFn = (input: { levers: Levers; services: ServiceBag; taskType: TaskTypeDef }) => string | null;

export interface LoadedTaskType {
  def: TaskTypeDef;
  vocabulary?: VocabularyFn;
  normalizer?: NormalizerFn;
  author?: AuthorFn;
  solver?: SolverFn;
  contextBlind?: ContextBlindFn;
  validators: ValidatorFn[];
  renderer?: RendererFn;
  expander?: ExpanderFn;
  scoring: ScoringModule;
}

export interface LoadedPlugin {
  manifest: Manifest;
  dir: string;
  brief: string;
  taskTypes: Map<string, LoadedTaskType>;
  exemplars: Map<string, Record<'easy' | 'medium' | 'hard', unknown[]>>;
  crossSession?: CrossSessionModule;
  leverModel: { coefficients: Record<string, number>; intercept: number; source: string } | null;
}

/** The modality an item actually realises, read with the task type's declared rule. */
export function modalityOf(tt: TaskTypeDef, blueprint: { phases?: { phase: string }[] } & Record<string, unknown>): Modality | null {
  if (tt.modalities.length === 1) return tt.modalities[0]!;
  if (!tt.modality_from) return null;
  const phase = (blueprint.phases ?? []).find((p) => p.phase === tt.modality_from!.phase) as Record<string, unknown> | undefined;
  let v: unknown = phase;
  for (const k of tt.modality_from.field.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined;
  return typeof v === 'string' ? tt.modality_from.map[v] ?? null : null;
}
