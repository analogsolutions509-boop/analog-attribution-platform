-- Provider call records remain valid even when no website number matches.
-- NULL site_id means unknown attribution; it must not block call or audio capture.
ALTER TABLE calls ALTER COLUMN site_id DROP NOT NULL;
