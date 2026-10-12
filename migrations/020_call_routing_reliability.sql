ALTER TABLE number_assignments
  ADD COLUMN IF NOT EXISTS attribution_valid BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS operator_call_sid TEXT;

CREATE INDEX IF NOT EXISTS idx_number_assignments_active_attribution
  ON number_assignments(tracking_number_id, expires_at)
  WHERE attribution_valid = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_site_call_id
  ON leads(site_id, (source_detail->>'call_id'))
  WHERE NULLIF(source_detail->>'call_id','') IS NOT NULL;
