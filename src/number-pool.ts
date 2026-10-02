import { db } from "./db.js";

const ASSIGNMENT_TTL_MS = 30 * 60 * 1000;

export async function assignTrackingNumber(siteId: string, visitorKey: string, sessionKey: string) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT tn.phone_number,na.id
       FROM number_assignments na
       JOIN tracking_numbers tn ON tn.id=na.tracking_number_id
       JOIN visitors v ON v.id=na.visitor_id AND v.site_id=$1
       JOIN sessions s ON s.id=na.session_id AND s.site_id=$1 AND s.visitor_id=v.id
       WHERE tn.site_id=$1 AND tn.active AND s.session_key=$2 AND v.visitor_key=$3 AND na.expires_at>NOW()
       ORDER BY na.last_seen_at DESC LIMIT 1`,
      [siteId, sessionKey, visitorKey]
    );
    const expires = new Date(Date.now() + ASSIGNMENT_TTL_MS);
    if (existing.rowCount) {
      await client.query("UPDATE number_assignments SET last_seen_at=NOW(),expires_at=$2 WHERE id=$1", [existing.rows[0].id, expires]);
      await client.query("COMMIT");
      return { phoneNumber: existing.rows[0].phone_number, expiresAt: expires.toISOString() };
    }
    const identity = await client.query(
      `SELECT v.id AS visitor_id,s.id AS session_id
       FROM visitors v JOIN sessions s ON s.visitor_id=v.id AND s.site_id=v.site_id
       WHERE v.site_id=$1 AND v.visitor_key=$2 AND s.session_key=$3 LIMIT 1`,
      [siteId, visitorKey, sessionKey]
    );
    if (!identity.rowCount) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query("DELETE FROM number_assignments WHERE expires_at<NOW()");
    const result = await client.query(
      `SELECT tn.id,tn.phone_number FROM tracking_numbers tn
       WHERE tn.site_id=$1 AND tn.active
         AND tn.forwarding_number_id IS NOT NULL
         AND tn.destination_supplier_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM number_assignments na WHERE na.tracking_number_id=tn.id AND na.expires_at>NOW())
       ORDER BY tn.id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [siteId]
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      "INSERT INTO number_assignments(tracking_number_id,visitor_id,session_id,expires_at) VALUES($1,$2,$3,$4)",
      [result.rows[0].id, identity.rows[0].visitor_id, identity.rows[0].session_id, expires]
    );
    await client.query("COMMIT");
    return { phoneNumber: result.rows[0].phone_number, expiresAt: expires.toISOString() };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function attributeNumberToCall(callId: string, siteId: string, calledNumber?: string) {
  const normalized = calledNumber?.replace(/\D/g, "");
  if (!normalized) return null;
  const result = await db.query(
    `SELECT na.visitor_id,na.session_id
     FROM number_assignments na
     JOIN tracking_numbers tn ON tn.id=na.tracking_number_id
     WHERE tn.site_id=$1
       AND regexp_replace(tn.phone_number,'\\D','','g')=$2
       AND na.expires_at>NOW()
     ORDER BY na.last_seen_at DESC LIMIT 1`,
    [siteId, normalized]
  );
  if (!result.rowCount) return null;
  await db.query("UPDATE calls SET attribution_confidence=0.99,attribution_method='dynamic_number',updated_at=NOW() WHERE id=$1", [callId]);
  return result.rows[0];
}
