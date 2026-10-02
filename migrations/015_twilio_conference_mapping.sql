ALTER TABLE calls ADD COLUMN IF NOT EXISTS conference_name TEXT;
CREATE INDEX IF NOT EXISTS idx_calls_twilio_conference_name ON calls(provider, conference_name) WHERE conference_name IS NOT NULL;
