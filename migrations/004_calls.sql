CREATE TABLE IF NOT EXISTS calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(id),
  lead_id UUID REFERENCES leads(id),
  provider TEXT NOT NULL,
  provider_call_id TEXT NOT NULL,
  caller_number TEXT,
  called_number TEXT,
  direction TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  status TEXT NOT NULL DEFAULT 'received',
  recording_status TEXT NOT NULL DEFAULT 'pending',
  recording_storage_key TEXT,
  recording_sha256 TEXT,
  transcript_status TEXT NOT NULL DEFAULT 'pending',
  transcript_text TEXT,
  transcript_segments JSONB NOT NULL DEFAULT '[]'::jsonb,
  intelligence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, provider_call_id)
);

CREATE INDEX IF NOT EXISTS idx_calls_site_started ON calls(site_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_lead ON calls(lead_id);
