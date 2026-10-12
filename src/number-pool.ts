import { db } from "./db.js";

const ASSIGNMENT_TTL_MS = 30 * 60 * 1000;

export type TrackingNumberAssignment =
  | {
      phoneNumber: string;
      expiresAt: string | null;
      attributionMode: "dynamic" | "shared_site";
    }
  | {
      error:
        | "visitor_session_not_found"
        | "tracking_number_not_configured"
        | "forwarding_route_not_configured"
        | "number_pool_exhausted";
    };

/**
 * Returns an eligible website number. A number is exclusive to a visitor only
 * while it is available in the dynamic pool. If every eligible number is
 * reserved, reuse an eligible site number for display, but invalidate any
 * visitor-level attribution attached to it: a shared number cannot identify
 * one particular visitor reliably.
 */
export async function assignTrackingNumber(
  siteId: string,
  visitorKey: string,
  sessionKey: string
): Promise<TrackingNumberAssignment> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT tn.phone_number,na.id,na.attribution_valid
       FROM number_assignments na
       JOIN tracking_numbers tn ON tn.id=na.tracking_number_id
       JOIN forwarding_numbers fn ON fn.id=tn.forwarding_number_id AND fn.active
       JOIN visitors v ON v.id=na.visitor_id AND v.site_id=$1
       JOIN sessions s ON s.id=na.session_id AND s.site_id=$1 AND s.visitor_id=v.id
       WHERE tn.site_id=$1 AND tn.active
         AND s.session_key=$2 AND v.visitor_key=$3 AND na.expires_at>NOW()
       ORDER BY na.last_seen_at DESC LIMIT 1`,
      [siteId, sessionKey, visitorKey]
    );

    const expires = new Date(Date.now() + ASSIGNMENT_TTL_MS);
    if (existing.rowCount) {
      await client.query(
        "UPDATE number_assignments SET last_seen_at=NOW(),expires_at=$2 WHERE id=$1",
        [existing.rows[0].id, expires]
      );
      await client.query("COMMIT");
      return {
        phoneNumber: existing.rows[0].phone_number,
        expiresAt: expires.toISOString(),
        attributionMode: existing.rows[0].attribution_valid ? "dynamic" : "shared_site"
      };
    }

    const identity = await client.query(
      `SELECT v.id AS visitor_id,s.id AS session_id
       FROM visitors v
       JOIN sessions s ON s.visitor_id=v.id AND s.site_id=v.site_id
       WHERE v.site_id=$1 AND v.visitor_key=$2 AND s.session_key=$3
       LIMIT 1`,
      [siteId, visitorKey, sessionKey]
    );
    if (!identity.rowCount) {
      await client.query("ROLLBACK");
      return { error: "visitor_session_not_found" };
    }

    await client.query("DELETE FROM number_assignments WHERE expires_at<NOW()");

    const result = await client.query(
      `SELECT tn.id,tn.phone_number
       FROM tracking_numbers tn
       JOIN forwarding_numbers fn ON fn.id=tn.forwarding_number_id AND fn.active
       WHERE tn.site_id=$1 AND tn.active
         AND NOT EXISTS (
           SELECT 1 FROM number_assignments na
           WHERE na.tracking_number_id=tn.id AND na.expires_at>NOW()
         )
       ORDER BY tn.id LIMIT 1 FOR UPDATE OF tn SKIP LOCKED`,
      [siteId]
    );

    if (result.rowCount) {
      await client.query(
        `INSERT INTO number_assignments(
           tracking_number_id,visitor_id,session_id,expires_at,attribution_valid
         ) VALUES($1,$2,$3,$4,TRUE)`,
        [result.rows[0].id, identity.rows[0].visitor_id, identity.rows[0].session_id, expires]
      );
      await client.query("COMMIT");
      return {
        phoneNumber: result.rows[0].phone_number,
        expiresAt: expires.toISOString(),
        attributionMode: "dynamic"
      };
    }

    // All numbers may be reserved, but a valid website number must continue
    // to display. This is a site-level fallback, not a new visitor assignment.
    const fallback = await client.query(
      `SELECT tn.id,tn.phone_number
       FROM tracking_numbers tn
       JOIN forwarding_numbers fn ON fn.id=tn.forwarding_number_id AND fn.active
       WHERE tn.site_id=$1 AND tn.active
       ORDER BY tn.id LIMIT 1 FOR UPDATE OF tn`,
      [siteId]
    );
    if (!fallback.rowCount) {
      const inventory = await client.query(
        `SELECT
           COUNT(*) FILTER (WHERE tn.active)::int AS active_numbers,
           COUNT(*) FILTER (WHERE tn.active AND fn.active)::int AS active_forwarding_routes
         FROM tracking_numbers tn
         LEFT JOIN forwarding_numbers fn ON fn.id=tn.forwarding_number_id
         WHERE tn.site_id=$1`,
        [siteId]
      );
      const activeNumbers = Number(inventory.rows[0]?.active_numbers ?? 0);
      const activeRoutes = Number(inventory.rows[0]?.active_forwarding_routes ?? 0);
      await client.query("ROLLBACK");
      if (!activeNumbers) return { error: "tracking_number_not_configured" };
      if (!activeRoutes) return { error: "forwarding_route_not_configured" };
      return { error: "number_pool_exhausted" };
    }

    await client.query(
      "UPDATE number_assignments SET attribution_valid=FALSE WHERE tracking_number_id=$1 AND expires_at>NOW()",
      [fallback.rows[0].id]
    );
    await client.query("COMMIT");
    return {
      phoneNumber: fallback.rows[0].phone_number,
      expiresAt: null,
      attributionMode: "shared_site"
    };
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
       AND na.attribution_valid=TRUE
     ORDER BY na.last_seen_at DESC LIMIT 1`,
    [siteId, normalized]
  );
  if (!result.rowCount) return null;
  await db.query(
    "UPDATE calls SET attribution_confidence=0.99,attribution_method='dynamic_number',updated_at=NOW() WHERE id=$1",
    [callId]
  );
  return result.rows[0];
}
