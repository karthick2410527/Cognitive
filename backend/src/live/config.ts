// Live-generation configuration (backend/config/generation.json, or GENERATION_CONFIG).
// Read on every use so it can be changed without restarting; validated with zod.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ROOT } from '../config';

const Level = z.object({ keep_ready: z.number().int().min(0).max(10), refill: z.number().int().min(1).max(8) });

const Schema = z.object({
  mode: z.enum(['live', 'bank']),
  initial_per_domain: z.number().int().min(0).max(10),
  // Each initial question is retried (with a different task type) until it passes the gates.
  initial_max_attempts: z.number().int().min(1).max(6).default(3),
  // A start question not written within this time (slow, rate limited, or failing) is replaced by a
  // stored question this user has not seen, so the session can begin; a late question is still kept.
  initial_deadline_ms: z.number().int().min(0).max(180000).default(30000),
  policy: z.object({
    kind: z.enum(['threshold', 'external']),
    // Per-domain thresholds on the domain's standard error (SE):
    //   SE > more.se_above            → "more": keep more questions ready
    //   target_se < SE ≤ more.se_above → "normal"
    //   SE ≤ the domain's target_se   → "none": measured well enough, stop generating
    threshold: z.object({
      max_in_flight_per_session: z.number().int().min(1).max(30),
      more: Level.extend({ se_above: z.number().min(0).max(5) }).optional(),
      normal: Level.optional(),
      stop_when_target_se_met: z.boolean().default(true),
      per_domain: z.record(z.object({ more: Level.partial().optional(), normal: Level.partial().optional(), enabled: z.boolean().optional() })).default({}),
      // Older single-threshold keys; used to derive more/normal when those are absent.
      min_ready_per_domain: z.number().int().min(0).max(20).optional(),
      refill_count: z.number().int().min(1).max(8).optional(),
    }).transform((t) => {
      const minReady = t.min_ready_per_domain ?? 1;
      const refill = t.refill_count ?? 2;
      return {
        ...t,
        more: t.more ?? { se_above: 0.6, keep_ready: minReady + 1, refill },
        normal: t.normal ?? { keep_ready: minReady, refill: Math.max(1, refill - 1) },
      };
    }),
    external: z.object({ url: z.string().url().nullable(), timeout_ms: z.number().int().min(100).max(30000), fallback_to_threshold: z.boolean() }),
  }),
  modality_ratio: z.object({ text: z.number().min(0).max(1), visual: z.number().min(0).max(1) }).refine((r) => Math.abs(r.text + r.visual - 1) < 1e-6, 'text + visual must equal 1'),
  wait_ms: z.object({ initial: z.number().int().min(0).max(120000), refill: z.number().int().min(0).max(60000) }),
  serve_unreviewed_live_items: z.boolean(),
  // Written (text) questions: 'freeform' writes them with the free-form question prompt (the model
  // picks the format; a second model call must confirm the key); 'typed' uses each domain's fixed
  // written task types. Stored freeform questions a user has not seen are reused before writing new ones.
  written: z.object({
    source: z.enum(['freeform', 'typed']).default('freeform'),
    // Domains that use the free-form writer; null = every domain that declares a freeform task type.
    domains: z.array(z.string()).nullable().default(null),
    options_per_question: z.number().int().min(3).max(6).default(4),
    per_call: z.number().int().min(1).max(8).default(3),
    verify: z.boolean().default(true),
    // Reading-level ceiling (US grade) for free-form questions. The prompt sets no reading level, so the
    // domains' own targets (grade 4–6) would reject most of what it writes.
    max_reading_grade: z.number().min(3).max(16).default(12),
    // generate_first: write a new question, and use a stored one only if that fails (provider paused,
    // quota used up, or every new question rejected). stored_first: reuse unseen stored ones first.
    order: z.enum(['generate_first', 'stored_first']).default('generate_first'),
    reuse_stored: z.boolean().default(true),
  }).default({}),
});
export type GenerationConfig = z.infer<typeof Schema>;

const file = () => process.env.GENERATION_CONFIG ?? path.join(ROOT, 'config', 'generation.json');
let cache: { mtime: number; cfg: GenerationConfig } | null = null;

export function generationConfig(): GenerationConfig {
  const f = file();
  const mtime = fs.statSync(f).mtimeMs;
  if (cache && cache.mtime === mtime) return cache.cfg;
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  delete raw.$comment;
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) throw new Error(`invalid ${f}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  cache = { mtime, cfg: parsed.data };
  return parsed.data;
}

/** Validates a full config object (as stored, $comment keys allowed) and writes it; returns the parsed config. */
export function writeGenerationConfig(raw: Record<string, unknown>): GenerationConfig {
  const copy = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  delete copy.$comment;
  const parsed = Schema.safeParse(copy);
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const f = file();
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(raw, null, 2) + '\n');
  fs.renameSync(`${f}.tmp`, f);
  cache = null;
  return parsed.data;
}

/** The config file as stored, including its $comment notes. */
export function rawGenerationConfig(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file(), 'utf8'));
}
