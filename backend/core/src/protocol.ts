// The Item Protocol (Doc 01 §4) and every schema boundary that crosses a trust line:
// LLM output, client responses, block submissions and subject profiles.
import { z } from 'zod';

export const ENGINE_VERSION = '2.0.0';

export const PROTOCOLS = ['single', 'encode_delay_retrieve', 'timed_block', 'cross_session', 'dual_task'] as const;
export type Protocol = (typeof PROTOCOLS)[number];

export const RENDER_TARGETS = ['dom', 'svg', 'scene'] as const;
export const ITEM_STATUSES = ['draft', 'validated', 'live', 'quarantined', 'retired'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const VARIANTS = ['default', 'high_contrast', 'large'] as const;
export type Variant = (typeof VARIANTS)[number];

// Locales and other strings that reach prompt layer L2 are closed enumerations, never free
// text (Doc 10 §2.3 — prompt injection via locale/profile fields).
export const LOCALES = ['en', 'en-IN'] as const;
export type Locale = (typeof LOCALES)[number];
export const READING_LEVELS = ['grade_3', 'grade_4', 'grade_5', 'grade_6', 'grade_8'] as const;
export const FIRST_LANGUAGES = ['english', 'hindi', 'tamil', 'telugu', 'bengali', 'marathi', 'kannada', 'malayalam', 'gujarati', 'urdu', 'other'] as const;

// ── Answer key: tagged union (Doc 02 §1 row 9) ────────────────────────────────────────
export const AnswerKeySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('index'), value: z.number().int().min(0) }),
  z.object({ kind: z.literal('index_set'), value: z.array(z.number().int().min(0)).min(1) }),
  z.object({ kind: z.literal('index_per_probe'), value: z.array(z.number().int().min(0)).min(1) }),
  z.object({ kind: z.literal('trial_sequence'), value: z.unknown() }),
  z.object({ kind: z.literal('free_text_reference'), value: z.string() }),
]);
export type AnswerKey = z.infer<typeof AnswerKeySchema>;

// ── Raw item as the LLM emits it (Doc 02 §6.1) ───────────────────────────────────────
export const PHASE_NAMES = ['encode', 'delay', 'retrieve', 'present', 'instructions', 'practice', 'trials'] as const;

export const PhaseSchema = z
  .object({
    phase: z.enum(PHASE_NAMES),
    stimuli: z.array(z.unknown()).optional(),
    presentation: z.record(z.unknown()).optional(),
    duration_ms: z.number().optional(),
    filler: z.string().nullable().optional(),
    probes: z.array(z.unknown()).optional(),
    stem: z.string().optional(),
    options: z.array(z.string()).optional(),
    trial_rule: z.record(z.unknown()).optional(),
    instruction_text: z.string().optional(),
  })
  .passthrough();
export type Phase = z.infer<typeof PhaseSchema>;

export const BlueprintSchema = z
  .object({
    phases: z.array(PhaseSchema).min(1),
    puzzle: z.record(z.unknown()).optional(),
    rule: z.record(z.unknown()).optional(),
  })
  .passthrough();
export type Blueprint = z.infer<typeof BlueprintSchema>;

export const LeverValueSchema = z.union([z.number(), z.string(), z.boolean(), z.array(z.union([z.number(), z.string()]))]);
export type LeverValue = z.infer<typeof LeverValueSchema>;
export type Levers = Record<string, LeverValue>;

/** Fields the model must never emit (Doc 02 §11 criterion 3). Checked by the structural gate. */
export const FORBIDDEN_MODEL_FIELDS = ['difficulty', 'discrimination', 'item_id', 'id', 'domain', 'difficulty_label', 'plugin_id', 'b', 'a'] as const;

export const RawItemSchema = z
  .object({
    task_type: z.string(),
    blueprint: BlueprintSchema,
    answer_key: AnswerKeySchema,
    rationale: z.string().max(300),
    lever_realisation: z.record(z.unknown()),
    lever_conflict: z.string().nullable().optional(),
    content_tags: z.array(z.string()).optional(),
    text_alternative: z.string().nullable().optional(),
  })
  .passthrough();
export type RawItem = z.infer<typeof RawItemSchema>;

export const GenerationResponseSchema = z.object({
  refusal: z.string().nullable().optional(),
  items: z.array(z.unknown()),
});

/** JSON schema handed to the provider for structured output (Doc 02 §6.1). */
export const GENERATION_JSON_SCHEMA = {
  type: 'object',
  required: ['items'],
  properties: {
    refusal: { type: ['string', 'null'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['task_type', 'blueprint', 'answer_key', 'rationale', 'lever_realisation'],
        properties: {
          task_type: { type: 'string' },
          blueprint: {
            type: 'object',
            required: ['phases'],
            properties: {
              phases: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['phase'],
                  properties: {
                    phase: { enum: [...PHASE_NAMES] },
                    stimuli: { type: 'array' },
                    presentation: { type: 'object' },
                    duration_ms: { type: 'number' },
                    filler: { type: ['string', 'null'] },
                    probes: { type: 'array' },
                    stem: { type: 'string' },
                    options: { type: 'array', items: { type: 'string' } },
                    trial_rule: { type: 'object' },
                    instruction_text: { type: 'string' },
                  },
                },
              },
              puzzle: { type: 'object' },
              rule: { type: 'object' },
            },
          },
          answer_key: {
            type: 'object',
            required: ['kind', 'value'],
            properties: {
              kind: { enum: ['index', 'index_set', 'index_per_probe', 'trial_sequence', 'free_text_reference'] },
              value: {},
            },
          },
          rationale: { type: 'string', maxLength: 300 },
          lever_realisation: { type: 'object' },
          lever_conflict: { type: ['string', 'null'] },
          content_tags: { type: 'array', items: { type: 'string' } },
          text_alternative: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const;

// ── Accessibility ─────────────────────────────────────────────────────────────────────
export const AccessibilitySchema = z.object({
  vision_required: z.boolean(),
  speech_required: z.boolean().default(false),
  hearing_required: z.boolean().default(false),
  literacy_required: z.boolean(),
  motor_demand: z.enum(['low', 'medium', 'high']),
  modality: z.enum(['visual', 'auditory', 'verbal', 'mixed']),
  colour_dependent: z.boolean(),
});
export type Accessibility = z.infer<typeof AccessibilitySchema>;

export const SubjectProfileSchema = z
  .object({
    device_class: z.enum(['phone', 'tablet', 'desktop']).default('desktop'),
    input_device: z.enum(['touch', 'mouse', 'keyboard']).default('mouse'),
    vision: z.enum(['typical', 'low', 'none']).default('typical'),
    hearing: z.enum(['typical', 'impaired']).default('typical'),
    literacy: z.enum(['typical', 'low']).default('typical'),
    motor: z.enum(['typical', 'limited']).default('typical'),
    colour_vision: z.enum(['typical', 'deficient']).default('typical'),
    high_contrast: z.boolean().default(false),
    large_targets: z.boolean().default(false),
    reduced_motion: z.boolean().default(false),
    education_years: z.number().int().min(0).max(30).nullable().default(null),
    first_language: z.enum(FIRST_LANGUAGES).default('english'),
    age_band: z.enum(['18-29', '30-44', '45-59', '60-69', '70-79', '80+']).nullable().default(null),
  })
  .strict();
export type SubjectProfile = z.infer<typeof SubjectProfileSchema>;

export const CreateSubjectSchema = z
  .object({
    external_ref: z.string().regex(/^[A-Za-z0-9_-]{4,64}$/).optional(),
    locale: z.enum(LOCALES).default('en'),
    profile: SubjectProfileSchema.default({}),
  })
  .strict();

// ── Responses (Doc 01 §4.4 / §4.5) ────────────────────────────────────────────────────
export const TIMING_QUALITIES = ['high', 'degraded', 'unusable'] as const;
export type TimingQuality = (typeof TIMING_QUALITIES)[number];

export const ResponseSubmissionSchema = z
  .object({
    response_uuid: z.string().uuid(),
    administration_id: z.string().uuid(),
    phase: z.enum(['present', 'retrieve', 'encode', 'delay']),
    probe_index: z.number().int().min(0).max(32).default(0),
    raw_input: z.union([
      z.object({ choice: z.number().int().min(0).max(16) }).strict(),
      z.object({ choices: z.array(z.number().int().min(0).max(16)).max(16) }).strict(),
      z.object({ timeout: z.literal(true) }).strict(),
      z.object({ filler: z.record(z.number()) }).strict(),
    ]),
    rt_ms: z.number().int().min(0).max(600_000).nullable(),
    rt_source: z.enum(['performance_now', 'event_timestamp', 'server_delta']).default('event_timestamp'),
    timing_quality: z.enum(TIMING_QUALITIES).default('high'),
    focus_lost_ms: z.number().int().min(0).max(3_600_000).default(0),
    client_clock_offset_ms: z.number().int().nullable().default(null),
    input_device: z.enum(['touch', 'mouse', 'keyboard', 'pen']).nullable().default(null),
  })
  .strict();
export type ResponseSubmission = z.infer<typeof ResponseSubmissionSchema>;

// ── Timed blocks: the generic trial vocabulary every block renderer understands ───────
export type ShapeName =
  | 'circle' | 'square' | 'triangle' | 'diamond' | 'pentagon' | 'hexagon' | 'star' | 'cross'
  | 'arrow' | 'chevron' | 'lshape' | 'semicircle' | 'tshape' | 'flag';
export type FillName = 'solid' | 'outline' | 'light' | 'hatched';
export type SizeName = 's' | 'm' | 'l';

export interface ShapeSpec { shape: ShapeName; fill: FillName; size: SizeName; rot: number }

export type Stimulus =
  | { kind: 'blank' }
  | { kind: 'fixation' }
  | { kind: 'digit'; value: number; scale?: number }
  | { kind: 'shape'; spec: ShapeSpec }
  | { kind: 'arrows'; dirs: ('L' | 'R' | 'N')[] }
  | { kind: 'positioned'; x: number; y: number; child: Stimulus }
  | { kind: 'grid'; cols: number; rows: number; cells: (ShapeSpec | null)[] }
  | { kind: 'pair'; left: Stimulus; right: Stimulus }
  | { kind: 'symbol'; id: number; set: string }
  | { kind: 'symbol_key'; set: string; pairs: { symbol: number; digit: number }[] }
  | { kind: 'symbol_row'; set: string; ids: number[]; highlight: number }
  | { kind: 'cue'; style: 'border_solid' | 'border_dashed' }
  | { kind: 'with_cue'; cue: 'border_solid' | 'border_dashed'; child: Stimulus };

export interface ResponseOption { id: string; label: string; key: string; glyph?: Stimulus }

export interface TrialSpec {
  index: number;
  stimulus: Stimulus;
  foreperiod_ms: number; // blank interval before onset
  stimulus_duration_ms: number | null; // null = visible until response or window end
  response_window_ms: number; // from onset; after this a non-response is recorded
  correct: string | null; // response id; null = the correct action is to withhold
  condition: string;
  meta?: Record<string, number | string | boolean>;
}

export interface BlockSpec {
  task_type: string;
  instruction_text: string;
  rule_reminder: string;
  responses: ResponseOption[];
  persistent: Stimulus | null; // e.g. a symbol key that stays on screen (Doc 09 §1.2)
  persistent_position: 'adjacent' | 'top';
  mode: 'paced' | 'self_paced';
  duration_s: number | null; // time-limited blocks stop here; null = run all trials
  practice: TrialSpec[];
  trials: TrialSpec[];
  practice_pass_accuracy: number;
  nudge: { max_mean_rt_ms: number; message: string } | null;
  feedback_in_practice: boolean;
  time_scale: number; // 1 except in explicitly flagged development sessions
}

export const TrialResultSchema = z
  .object({
    index: z.number().int().min(0).max(5000),
    onset_ms: z.number().min(0).max(3_600_000),
    response: z.string().max(16).nullable(),
    rt_ms: z.number().min(0).max(60_000).nullable(),
    timing_quality: z.enum(TIMING_QUALITIES),
    focus_lost_ms: z.number().min(0).max(3_600_000).default(0),
  })
  .strict();
export type TrialResult = z.infer<typeof TrialResultSchema>;

export const DeviceProfileSchema = z
  .object({
    frame_period_ms: z.number().min(1).max(200),
    frame_jitter_ms: z.number().min(0).max(200),
    input_latency_ms: z.number().min(0).max(500).nullable(),
    render_cost_ms: z.number().min(0).max(1000),
    refresh_hz: z.number().min(5).max(500),
    device_class: z.enum(['phone', 'tablet', 'desktop']),
    presentation_api: z.boolean(),
  })
  .strict();
export type DeviceProfile = z.infer<typeof DeviceProfileSchema>;

export const BlockSubmissionSchema = z
  .object({
    sequence_hash: z.string().max(80),
    attempt: z.number().int().min(1).max(2),
    status: z.enum(['completed', 'aborted']),
    abort_reason: z.enum(['degraded_trials', 'focus_lost', 'practice_failed', 'user']).nullable().default(null),
    wall_ms: z.number().min(0).max(3_600_000),
    client_clock_offset_ms: z.number().int().nullable().default(null),
    input_device: z.enum(['touch', 'mouse', 'keyboard', 'pen']),
    device_profile: DeviceProfileSchema.nullable().default(null),
    practice_attempts: z.number().int().min(0).max(50).default(1),
    trials: z.array(TrialResultSchema).max(5000),
  })
  .strict();
export type BlockSubmission = z.infer<typeof BlockSubmissionSchema>;
