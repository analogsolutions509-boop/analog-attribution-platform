CREATE TABLE IF NOT EXISTS tracking_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  label TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(site_id,phone_number)
);

CREATE TABLE IF NOT EXISTS number_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_number_id UUID NOT NULL REFERENCES tracking_numbers(id) ON DELETE CASCADE,
  visitor_id UUID REFERENCES visitors(id),
  session_id UUID REFERENCES sessions(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(tracking_number_id)
);

CREATE INDEX IF NOT EXISTS idx_tracking_numbers_site ON tracking_numbers(site_id,active);
CREATE INDEX IF NOT EXISTS idx_number_assignments_session ON number_assignments(session_id);
