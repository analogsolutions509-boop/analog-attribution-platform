ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notification_email TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notification_sms TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS outcome TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS site_suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 5),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(site_id, supplier_id),
  UNIQUE(site_id, rank)
);

CREATE TABLE IF NOT EXISTS transfer_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  mode TEXT NOT NULL CHECK (mode IN ('blind','warm')),
  provider TEXT NOT NULL,
  provider_transfer_id TEXT,
  rank INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  ring_seconds INTEGER,
  result TEXT NOT NULL DEFAULT 'initiated',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfer_attempts_call ON transfer_attempts(call_id,created_at);
CREATE INDEX IF NOT EXISTS idx_transfer_attempts_supplier ON transfer_attempts(supplier_id,created_at);

CREATE TABLE IF NOT EXISTS lead_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email','sms','form','chat','whatsapp','manual')),
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  sender TEXT,
  recipient TEXT,
  subject TEXT,
  body TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_messages_lead ON lead_messages(lead_id,created_at);
CREATE INDEX IF NOT EXISTS idx_lead_messages_site ON lead_messages(site_id,created_at);
CREATE TABLE IF NOT EXISTS lead_outcome_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES suppliers(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outcome_tokens_lookup ON lead_outcome_tokens(token_hash,expires_at);

CREATE TABLE IF NOT EXISTS report_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by TEXT,
  site_ids UUID[] NOT NULL DEFAULT '{}',
  supplier_ids UUID[] NOT NULL DEFAULT '{}',
  channels TEXT[] NOT NULL DEFAULT '{}',
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  metrics JSONB NOT NULL DEFAULT '[]'::jsonb,
  format TEXT NOT NULL CHECK (format IN ('pdf','csv')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calls_site_time_status ON calls(site_id,created_at,status);
CREATE INDEX IF NOT EXISTS idx_leads_site_created_status ON leads(site_id,created_at,status);
CREATE INDEX IF NOT EXISTS idx_leads_outcome ON leads(outcome);
CREATE INDEX IF NOT EXISTS idx_leads_tags_gin ON leads USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_transcripts_full_text ON call_transcripts USING GIN(to_tsvector('simple',coalesce(full_text,'')));
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('internal','supplier')),
  channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','sent','skipped','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_queue ON notifications(status,created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_lead ON notifications(lead_id,created_at DESC);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS call_id UUID REFERENCES calls(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS ux_notifications_call_recipient_channel
  ON notifications(call_id,recipient_type,channel) WHERE call_id IS NOT NULL;