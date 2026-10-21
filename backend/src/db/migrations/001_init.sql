-- Cognimetric v2 — initial schema (Doc 01 §5), with the additions the engine needs to make
-- sessions resumable and every rejection countable. Forward-only.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Plugins & taxonomy ─────────────────────────────────────────────
CREATE TABLE plugins (
  plugin_id   text PRIMARY KEY,
  name        text NOT NULL,
  version     text NOT NULL,
  manifest    jsonb NOT NULL,
  dimensions  text[] NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  loaded_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE task_types (
  task_type text PRIMARY KEY,
  plugin_id text NOT NULL REFERENCES plugins,
  protocol  text NOT NULL,
  renderer  text NOT NULL,
  solver    text,
  spec      jsonb NOT NULL
);

-- ── Item bank ──────────────────────────────────────────────────────
CREATE TABLE items (
  item_id          uuid PRIMARY KEY,
  plugin_id        text NOT NULL REFERENCES plugins,
  plugin_version   text NOT NULL,
  task_type        text NOT NULL REFERENCES task_types,
  protocol         text NOT NULL,
  blueprint        jsonb NOT NULL,
  levers           jsonb NOT NULL,
  answer_key       jsonb NOT NULL,
  response_spec    jsonb NOT NULL,
  accessibility    jsonb NOT NULL,
  locale           text NOT NULL,
  reading_level    text,
  content_tags     text[] NOT NULL DEFAULT '{}',
  difficulty_b     double precision NOT NULL,
  discrimination_a double precision NOT NULL DEFAULT 1.0,
  param_source     text NOT NULL DEFAULT 'lever_model',
  b_band           double precision NOT NULL,
  blueprint_hash   text NOT NULL,
  provenance       jsonb NOT NULL,
  verification     jsonb NOT NULL DEFAULT '{}',
  rationale        text,
  text_alternative text,
  status           text NOT NULL DEFAULT 'draft',
  review           jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT items_hash_unique UNIQUE (plugin_id, task_type, blueprint_hash),
  CONSTRAINT items_status_chk CHECK (status IN ('draft','validated','live','quarantined','retired'))
);
CREATE INDEX items_select_idx ON items (plugin_id, task_type, status, locale, difficulty_b);
CREATE INDEX items_cell_idx ON items (plugin_id, task_type, locale, b_band, status);
CREATE INDEX items_tags_idx ON items USING gin (content_tags);
CREATE INDEX items_prompt_idx ON items ((provenance->'generator'->>'prompt_version'));

CREATE TABLE item_embeddings (
  item_id   uuid PRIMARY KEY REFERENCES items ON DELETE CASCADE,
  embedding vector(768) NOT NULL
);
CREATE INDEX ON item_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE TABLE item_renderings (
  item_id      uuid NOT NULL REFERENCES items ON DELETE CASCADE,
  target       text NOT NULL,
  variant      text NOT NULL DEFAULT 'default',
  payload      text NOT NULL,
  renderer_ver text NOT NULL,
  bytes        int NOT NULL,
  PRIMARY KEY (item_id, target, variant)
);

CREATE TABLE item_validations (
  item_id    uuid NOT NULL REFERENCES items ON DELETE CASCADE,
  gate       text NOT NULL,
  verdict    text NOT NULL,
  detail     jsonb,
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, gate)
);

CREATE TABLE item_stats (
  item_id         uuid PRIMARY KEY REFERENCES items ON DELETE CASCADE,
  n_administered  int NOT NULL DEFAULT 0,
  n_correct       double precision NOT NULL DEFAULT 0,
  p_value         double precision,
  point_biserial  double precision,
  mean_rt_ms      double precision,
  fit_infit       double precision,
  last_exposed_at timestamptz,
  drift_flag      boolean NOT NULL DEFAULT false,
  flags           text[] NOT NULL DEFAULT '{}'
);

-- Every rejected candidate is a row: gate, reason, plugin, task type, band, prompt version (Doc 10 §2.2).
CREATE TABLE item_rejections (
  id             bigserial PRIMARY KEY,
  job_id         uuid,
  plugin_id      text NOT NULL,
  task_type      text NOT NULL,
  locale         text NOT NULL,
  b_band         double precision,
  prompt_version text NOT NULL,
  gate           text NOT NULL,
  reason_code    text NOT NULL,
  detail         jsonb,
  raw            jsonb,
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX item_rejections_cell_idx ON item_rejections (plugin_id, task_type, gate, at);

-- ── Sessions & administration ──────────────────────────────────────
CREATE TABLE subjects (
  subject_id    uuid PRIMARY KEY,
  external_ref  text UNIQUE,
  locale        text NOT NULL DEFAULT 'en',
  profile       jsonb NOT NULL DEFAULT '{}',
  session_count int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  session_id       uuid PRIMARY KEY,
  subject_id       uuid NOT NULL REFERENCES subjects,
  battery_id       text NOT NULL,
  phase            text NOT NULL,
  block_plan       jsonb NOT NULL,
  engine_state     jsonb NOT NULL DEFAULT '{}',
  locale           text NOT NULL,
  session_index    int NOT NULL DEFAULT 1,
  device_profile   jsonb,
  flags            jsonb NOT NULL DEFAULT '{}',
  started_at       timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  suspended_at     timestamptz,
  completed_at     timestamptz,
  stop_reason      text,
  engine_ver       text NOT NULL,
  CONSTRAINT sessions_phase_chk CHECK (phase IN ('calibration','adaptive','confirmation','done'))
);

CREATE TABLE administrations (
  administration_id     uuid PRIMARY KEY,
  session_id            uuid NOT NULL REFERENCES sessions,
  item_id               uuid NOT NULL REFERENCES items,
  plugin_id             text NOT NULL,
  task_type             text NOT NULL,
  block_index           int NOT NULL,
  position              int NOT NULL,
  theta_at_serve        jsonb NOT NULL,
  target_b              double precision,
  tier                  text NOT NULL DEFAULT 'A',
  substitution_distance double precision NOT NULL DEFAULT 0,
  seed                  bigint NOT NULL,
  option_order          jsonb NOT NULL DEFAULT '[]',
  block_state           jsonb,
  score                 jsonb,
  served_at             timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz,
  scored_at             timestamptz,
  state                 text NOT NULL DEFAULT 'served',
  CONSTRAINT admin_state_chk CHECK (state IN ('served','answered','expired','abandoned','unmeasured'))
);
CREATE UNIQUE INDEX admin_no_repeat ON administrations (session_id, item_id);
CREATE INDEX admin_session_idx ON administrations (session_id, position);
CREATE INDEX admin_item_idx ON administrations (item_id, served_at);

CREATE TABLE responses (
  response_uuid         uuid PRIMARY KEY,
  administration_id     uuid NOT NULL REFERENCES administrations,
  phase                 text NOT NULL,
  probe_index           int NOT NULL DEFAULT 0,
  raw_input             jsonb NOT NULL,
  scored_correct        boolean,
  rt_ms                 int,
  rt_source             text,
  timing_quality        text NOT NULL DEFAULT 'high',
  client_clock_offset_ms int,
  focus_lost_ms         int NOT NULL DEFAULT 0,
  input_device          text,
  submitted_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX responses_admin_idx ON responses (administration_id, phase, probe_index);

CREATE TABLE block_submissions (
  administration_id uuid NOT NULL REFERENCES administrations,
  attempt           int NOT NULL,
  status            text NOT NULL,
  payload           jsonb NOT NULL,
  checks            jsonb NOT NULL,
  verdict           text NOT NULL,
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (administration_id, attempt)
);

CREATE TABLE ability_estimates (
  session_id uuid NOT NULL REFERENCES sessions,
  dimension  text NOT NULL,
  theta      double precision NOT NULL,
  se         double precision NOT NULL,
  theta_mle  double precision,
  n_items    int NOT NULL,
  method     text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, dimension)
);

-- ── Cross-session probes (delayed recall) ──────────────────────────
-- Answers are autobiographical: encrypted at rest with pgcrypto, shortest retention (Doc 01 §9).
CREATE TABLE recall_probes (
  probe_id        uuid PRIMARY KEY,
  subject_id      uuid NOT NULL REFERENCES subjects,
  session_id      uuid REFERENCES sessions,
  question        text NOT NULL,
  stored_answer   bytea,
  specificity     text NOT NULL,
  asked_at        timestamptz NOT NULL,
  due_at          timestamptz NOT NULL,
  reprobed_at     timestamptz,
  response_answer bytea,
  grade           text,
  retrieval_score double precision,
  delete_after    timestamptz NOT NULL,
  state           text NOT NULL DEFAULT 'pending'
);
CREATE INDEX recall_due_idx ON recall_probes (subject_id, state, due_at);

-- ── Generation & governance ────────────────────────────────────────
CREATE TABLE generation_jobs (
  job_id         uuid PRIMARY KEY,
  kind           text NOT NULL,
  plugin_id      text NOT NULL,
  task_type      text,
  locale         text NOT NULL DEFAULT 'en',
  target_b       double precision,
  b_band         double precision,
  requested      int NOT NULL,
  accepted       int NOT NULL DEFAULT 0,
  rejected       int NOT NULL DEFAULT 0,
  reject_reasons jsonb NOT NULL DEFAULT '{}',
  prompt_version text NOT NULL,
  model          text NOT NULL,
  provider       text NOT NULL DEFAULT 'local',
  tokens_in      int, tokens_out int, cost_usd numeric(10,6),
  latency_ms     int,
  attempts       int NOT NULL DEFAULT 0,
  error          text,
  state          text NOT NULL DEFAULT 'queued',
  created_at     timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  finished_at    timestamptz
);
CREATE INDEX generation_jobs_queue_idx ON generation_jobs (state, created_at);
CREATE INDEX generation_jobs_cell_idx ON generation_jobs (plugin_id, task_type, locale, b_band, created_at);

CREATE TABLE prompt_versions (
  prompt_version text PRIMARY KEY,
  layer          text NOT NULL,
  plugin_id      text,
  body           text NOT NULL,
  body_hash      text NOT NULL,
  activated_at   timestamptz,
  retired_at     timestamptz,
  notes          text
);

-- Per-cell circuit breaker (Doc 02 §6.3).
CREATE TABLE cell_breakers (
  plugin_id  text NOT NULL,
  task_type  text NOT NULL,
  locale     text NOT NULL,
  b_band     double precision NOT NULL,
  tripped_at timestamptz,
  histogram  jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (plugin_id, task_type, locale, b_band)
);

CREATE TABLE provider_status (
  provider   text PRIMARY KEY,
  model      text NOT NULL,
  state      text NOT NULL,
  note       text,
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lever_models (
  plugin_id    text NOT NULL,
  task_type    text NOT NULL,
  locale       text NOT NULL,
  intercept    double precision NOT NULL,
  coefficients jsonb NOT NULL,
  n_responses  int NOT NULL,
  fitted_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plugin_id, task_type, locale)
);

CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  actor        text NOT NULL,
  action       text NOT NULL,
  subject_kind text,
  subject_ref  text,
  detail       jsonb,
  at           timestamptz NOT NULL DEFAULT now()
);
