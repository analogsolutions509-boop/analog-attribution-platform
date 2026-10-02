CREATE TABLE IF NOT EXISTS analog_os_reconciliation_runs (
  reconciliation_date DATE PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  os_leads INTEGER NOT NULL DEFAULT 0,
  matched INTEGER NOT NULL DEFAULT 0,
  imported INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  unresolved INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analog_os_recovery_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_date DATE NOT NULL,
  source TEXT NOT NULL,
  source_record TEXT NOT NULL,
  os_lead_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('matched_existing','imported','unresolved','error')),
  match_method TEXT,
  platform_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(reconciliation_date,source,source_record)
);

CREATE INDEX IF NOT EXISTS idx_analog_os_recovery_date
  ON analog_os_recovery_records(reconciliation_date,status);

CREATE INDEX IF NOT EXISTS idx_analog_os_recovery_platform_lead
  ON analog_os_recovery_records(platform_lead_id);

CREATE INDEX IF NOT EXISTS idx_leads_analog_os_source_record
  ON leads ((source_detail->>'analog_os_source_record'))
  WHERE source_detail ? 'analog_os_source_record';

