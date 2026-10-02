ALTER TABLE tracking_numbers
  ADD COLUMN IF NOT EXISTS destination_supplier_id UUID
  REFERENCES suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tracking_numbers_destination_supplier
  ON tracking_numbers(destination_supplier_id);

