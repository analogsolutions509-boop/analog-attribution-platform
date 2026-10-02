ALTER TABLE presspilot_connections
  ADD COLUMN IF NOT EXISTS connection_mode TEXT NOT NULL DEFAULT 'rest',
  ADD COLUMN IF NOT EXISTS agent_endpoint TEXT,
  ADD COLUMN IF NOT EXISTS agent_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS agent_last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agent_version TEXT;

DO $$ BEGIN
  ALTER TABLE presspilot_connections
    ADD CONSTRAINT presspilot_connections_mode_check
    CHECK (connection_mode IN ('rest','agent'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_presspilot_connections_agent_token
  ON presspilot_connections(agent_token_hash)
  WHERE agent_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS presspilot_pairings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash TEXT NOT NULL UNIQUE,
  created_by TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ,
  connection_id UUID REFERENCES presspilot_connections(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_presspilot_pairings_active
  ON presspilot_pairings(expires_at, claimed_at);
CREATE INDEX IF NOT EXISTS idx_presspilot_connections_agent_mode
  ON presspilot_connections(connection_mode,agent_last_seen_at);
ALTER TABLE presspilot_connections ADD COLUMN IF NOT EXISTS encrypted_agent_token TEXT;
