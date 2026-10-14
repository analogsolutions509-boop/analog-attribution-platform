CREATE TABLE IF NOT EXISTS analog_os_monthly_snapshots (
  month_key TEXT PRIMARY KEY
    CHECK (month_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  generated_at TIMESTAMPTZ NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  days_queried INTEGER NOT NULL DEFAULT 0 CHECK (days_queried BETWEEN 0 AND 31),
  lead_count INTEGER NOT NULL DEFAULT 0 CHECK (lead_count >= 0),
  counts JSONB NOT NULL DEFAULT '{"total":0,"whatconverts":0,"email":0}'::jsonb,
  leads JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(leads) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analog_os_monthly_snapshots_refreshed
  ON analog_os_monthly_snapshots(refreshed_at DESC);
