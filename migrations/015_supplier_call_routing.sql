ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS source_supplier_id UUID
  REFERENCES suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_calls_source_supplier
  ON calls(source_supplier_id,started_at DESC);
