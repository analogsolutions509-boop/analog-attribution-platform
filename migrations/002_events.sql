CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(id),
  visitor_id UUID REFERENCES visitors(id),
  session_id UUID REFERENCES sessions(id),
  event_key TEXT NOT NULL,
  event_name TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  page_url TEXT,
  page_path TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'wordpress',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(site_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_events_site_time ON events(site_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_session_time ON events(session_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_name_time ON events(event_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_payload_gin ON events USING GIN(payload);
