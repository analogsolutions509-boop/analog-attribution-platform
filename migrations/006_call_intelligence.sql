CREATE TABLE IF NOT EXISTS recording_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  storage_provider TEXT NOT NULL,
  bucket TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT,
  sha256 TEXT,
  duration_seconds NUMERIC(12,3),
  status TEXT NOT NULL DEFAULT 'pending',
  retention_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS call_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  language TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  full_text TEXT,
  duration_seconds NUMERIC(12,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(call_id)
);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id UUID NOT NULL REFERENCES call_transcripts(id) ON DELETE CASCADE,
  segment_index INTEGER NOT NULL,
  speaker_label TEXT NOT NULL,
  speaker_role TEXT,
  start_seconds NUMERIC(12,3) NOT NULL,
  end_seconds NUMERIC(12,3) NOT NULL,
  text TEXT NOT NULL,
  UNIQUE(transcript_id, segment_index)
);

CREATE TABLE IF NOT EXISTS call_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  summary TEXT,
  customer_name TEXT,
  company_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  intent TEXT,
  lead_type TEXT,
  buying_stage TEXT,
  urgency TEXT,
  sentiment TEXT,
  outcome TEXT,
  next_action TEXT,
  objections JSONB NOT NULL DEFAULT '[]'::jsonb,
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  commitments JSONB NOT NULL DEFAULT '[]'::jsonb,
  topics JSONB NOT NULL DEFAULT '[]'::jsonb,
  construction_requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC(5,4),
  raw_output JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(call_id)
);

CREATE TABLE IF NOT EXISTS call_extracted_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  field_group TEXT NOT NULL,
  normalized_value TEXT,
  display_value TEXT,
  confidence NUMERIC(5,4),
  evidence_start_seconds NUMERIC(12,3),
  evidence_end_seconds NUMERIC(12,3),
  evidence_text TEXT,
  source_type TEXT NOT NULL DEFAULT 'transcript',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recordings_call ON recording_assets(call_id);
CREATE INDEX IF NOT EXISTS idx_segments_transcript ON transcript_segments(transcript_id, segment_index);
CREATE INDEX IF NOT EXISTS idx_extracted_call ON call_extracted_fields(call_id, field_group, field_key);
CREATE INDEX IF NOT EXISTS idx_intelligence_intent ON call_intelligence(intent);
