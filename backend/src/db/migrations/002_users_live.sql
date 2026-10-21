-- Users and login, per-user activity tracking, and live (per-session) generation with a buffer.
-- Users stay pseudonymous: a username and a password hash, no email, no real name (Doc 01 §9).

CREATE TABLE users (
  user_id         uuid PRIMARY KEY,
  username        text NOT NULL,
  username_lower  text NOT NULL UNIQUE,
  password_hash   text NOT NULL,
  subject_id      uuid NOT NULL UNIQUE REFERENCES subjects,
  role            text NOT NULL DEFAULT 'user',
  failed_logins   int NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz,
  CONSTRAINT users_role_chk CHECK (role IN ('user','admin'))
);

-- Opaque session tokens; only their SHA-256 is stored.
CREATE TABLE auth_sessions (
  token_hash   text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent   text
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id);

CREATE TABLE user_events (
  id      bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  kind    text NOT NULL,
  detail  jsonb,
  at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_events_user_idx ON user_events (user_id, at DESC);

ALTER TABLE sessions ADD COLUMN user_id uuid REFERENCES users;
ALTER TABLE sessions ADD COLUMN mode text NOT NULL DEFAULT 'bank';
CREATE INDEX sessions_user_idx ON sessions (user_id, started_at DESC);

-- text = words or numerals; visual = figures, shapes, pictures, grids.
ALTER TABLE items ADD COLUMN modality text;
ALTER TABLE administrations ADD COLUMN modality text;
ALTER TABLE administrations ADD COLUMN source text NOT NULL DEFAULT 'bank';
ALTER TABLE generation_jobs ADD COLUMN session_id uuid;
ALTER TABLE generation_jobs ADD COLUMN modality text;

-- Per-session buffer of questions generated live for that session.
CREATE TABLE session_buffer (
  buffer_id  bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions,
  plugin_id  text NOT NULL,
  task_type  text NOT NULL,
  item_id    uuid NOT NULL REFERENCES items,
  modality   text NOT NULL,
  target_b   double precision NOT NULL,
  job_id     uuid,
  state      text NOT NULL DEFAULT 'ready',
  created_at timestamptz NOT NULL DEFAULT now(),
  served_at  timestamptz,
  CONSTRAINT session_buffer_state_chk CHECK (state IN ('ready','served','discarded'))
);
CREATE INDEX session_buffer_idx ON session_buffer (session_id, plugin_id, state);
