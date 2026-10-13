-- Keep inbound calls from the shared SecondRing line without falsely
-- attributing them to one of the customer-facing websites.
ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS attribution_method TEXT NOT NULL DEFAULT 'unknown';

INSERT INTO sites (site_key_hash, hostname, name, status)
SELECT encode(digest(gen_random_bytes(32), 'sha256'), 'hex'),
       'shared-secondring-line.internal',
       'SecondRing Shared Line (Unattributed)',
       'paused'
WHERE NOT EXISTS (
  SELECT 1 FROM sites WHERE hostname = 'shared-secondring-line.internal'
);
