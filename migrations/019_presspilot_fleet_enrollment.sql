CREATE TABLE IF NOT EXISTS presspilot_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  site_url TEXT NOT NULL,
  created_by TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ,
  connection_id UUID REFERENCES presspilot_connections(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_presspilot_enrollments_active
  ON presspilot_enrollments(expires_at, claimed_at);
