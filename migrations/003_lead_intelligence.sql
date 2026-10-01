CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(id),
  visitor_id UUID REFERENCES visitors(id),
  session_id UUID REFERENCES sessions(id),
  status TEXT NOT NULL DEFAULT 'new',
  source_confidence TEXT NOT NULL DEFAULT 'unknown',
  customer_name TEXT,
  company_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  service_type TEXT,
  requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_site_status ON leads(site_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
