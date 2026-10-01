import { db } from "./db.js";

export async function assignTrackingNumber(siteId: string, visitorId: string, sessionId: string) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT tn.phone_number FROM number_assignments na
       JOIN tracking_numbers tn ON tn.id=na.tracking_number_id
       WHERE tn.site_id=$1 AND na.session_id=$2 AND na.expires_at>NOW()
       ORDER BY na.last_seen_at DESC LIMIT 1`,
      [siteId,sessionId]
    );
    if (existing.rowCount) {
      const expires = new Date(Date.now()+30*60*1000);
      await client.query("UPDATE number_assignments SET visitor_id=$2,last_seen_at=NOW(),expires_at=$3 WHERE session_id=$1",[sessionId,visitorId,expires]);
      await client.query("COMMIT");
      return { phoneNumber: existing.rows[0].phone_number, expiresAt: expires.toISOString() };
    }
    await client.query("DELETE FROM number_assignments WHERE expires_at<NOW()");
    const result = await client.query(
      `SELECT tn.id,tn.phone_number FROM tracking_numbers tn
       WHERE tn.site_id=$1 AND tn.active
       AND NOT EXISTS (SELECT 1 FROM number_assignments na WHERE na.tracking_number_id=tn.id AND na.expires_at>NOW())
       ORDER BY tn.id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [siteId]
    );
    if (!result.rowCount) { await client.query("ROLLBACK"); return null; }
    const expires = new Date(Date.now()+30*60*1000);
    await client.query(
      "INSERT INTO number_assignments(tracking_number_id,visitor_id,session_id,expires_at) VALUES($1,$2,$3,$4)",
      [result.rows[0].id,visitorId,sessionId,expires]
    );
    await client.query("COMMIT");
    return { phoneNumber: result.rows[0].phone_number, expiresAt: expires.toISOString() };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function attributeNumberToCall(callId: string, siteId: string, calledNumber?: string) {
  if (!calledNumber) return null;
  const result = await db.query(
    `SELECT na.visitor_id,na.session_id FROM number_assignments na
     JOIN tracking_numbers tn ON tn.id=na.tracking_number_id
     WHERE tn.site_id=$1 AND tn.phone_number=$2 AND na.expires_at>NOW()
     ORDER BY na.last_seen_at DESC LIMIT 1`,
    [siteId,calledNumber]
  );
  if (!result.rowCount) return null;
  await db.query("UPDATE calls SET attribution_confidence=0.99,attribution_method='dynamic_number',updated_at=NOW() WHERE id=$1",[callId]);
  return result.rows[0];
}
