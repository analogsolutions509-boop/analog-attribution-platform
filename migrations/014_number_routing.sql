CREATE TABLE IF NOT EXISTS forwarding_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT NOT NULL UNIQUE,
  label TEXT,
  provider TEXT NOT NULL DEFAULT 'unknown',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tracking_numbers
  ADD COLUMN IF NOT EXISTS forwarding_number_id UUID
  REFERENCES forwarding_numbers(id) ON DELETE SET NULL;

ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS tracking_number_id UUID
  REFERENCES tracking_numbers(id) ON DELETE SET NULL;
ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS forwarding_number_id UUID
  REFERENCES forwarding_numbers(id) ON DELETE SET NULL;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS tracking_number TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS forwarding_number TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS destination_number TEXT;

CREATE INDEX IF NOT EXISTS idx_tracking_numbers_forwarding
  ON tracking_numbers(forwarding_number_id);
CREATE INDEX IF NOT EXISTS idx_calls_tracking_number
  ON calls(tracking_number_id);

UPDATE calls c
SET tracking_number_id=tn.id,
    forwarding_number_id=tn.forwarding_number_id,
    tracking_number=COALESCE(c.tracking_number,tn.phone_number),
    forwarding_number=COALESCE(c.forwarding_number,fn.phone_number),
    destination_number=COALESCE(
      c.destination_number,
      NULLIF(s.contact_phone,''),
      NULLIF(s.endpoint_url,'')
    )
FROM tracking_numbers tn
LEFT JOIN forwarding_numbers fn ON fn.id=tn.forwarding_number_id
LEFT JOIN suppliers s ON s.id=tn.destination_supplier_id
WHERE c.site_id=tn.site_id
  AND regexp_replace(COALESCE(c.called_number,''),'\\D','','g') =
      regexp_replace(tn.phone_number,'\\D','','g');
