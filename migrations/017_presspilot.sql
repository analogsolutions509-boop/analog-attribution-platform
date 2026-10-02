CREATE TABLE IF NOT EXISTS presspilot_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  base_url TEXT NOT NULL,
  wp_username TEXT NOT NULL,
  encrypted_app_password TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('pending','verified','error','disabled')),
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_verified_at TIMESTAMPTZ,
  last_error TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(base_url,wp_username)
);

CREATE INDEX IF NOT EXISTS idx_presspilot_connections_site ON presspilot_connections(site_id);

CREATE TABLE IF NOT EXISTS presspilot_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES presspilot_connections(id) ON DELETE CASCADE,
  created_by TEXT,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planning','running','completed','failed')),
  plan JSONB,
  results JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_presspilot_runs_connection_created
  ON presspilot_runs(connection_id,created_at DESC);
