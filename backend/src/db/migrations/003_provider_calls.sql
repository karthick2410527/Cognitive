-- One shared record of provider calls, so every process (API, workers, scripts) stays inside the
-- provider's requests-per-minute limit together instead of each pacing itself alone.
CREATE TABLE provider_calls (
  id       bigserial PRIMARY KEY,
  at       timestamptz NOT NULL DEFAULT now(),
  priority text NOT NULL DEFAULT 'background',
  CONSTRAINT provider_calls_priority_chk CHECK (priority IN ('live', 'background'))
);
CREATE INDEX provider_calls_at_idx ON provider_calls (at);
