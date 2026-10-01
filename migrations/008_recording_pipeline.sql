ALTER TABLE calls ADD COLUMN IF NOT EXISTS recording_source_url TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS recording_mime_type TEXT;

CREATE INDEX IF NOT EXISTS idx_calls_recording_pending
  ON calls(recording_status, updated_at)
  WHERE recording_status = 'pending';
