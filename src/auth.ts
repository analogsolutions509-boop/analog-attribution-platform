import { createHmac, randomBytes } from "node:crypto";
import { db } from "./db.js";
import { config } from "./config.js";

function hashSiteKey(rawKey: string): string {
  return createHmac("sha256", config.ANALOG_SITE_KEY_SECRET)
    .update(rawKey)
    .digest("hex");
}

export function generateSiteKey(): string {
  return `as_${randomBytes(32).toString("base64url")}`;
}

export async function resolveSite(rawKey: string | undefined) {
  if (!rawKey) return null;
  const hash = hashSiteKey(rawKey);
  const result = await db.query(
    "SELECT id, hostname, name, status FROM sites WHERE site_key_hash = $1 LIMIT 1",
    [hash]
  );
  const site = result.rows[0] ?? null;
  if (!site || site.status !== "active") return null;
  return site;
}

export function hashGeneratedSiteKey(rawKey: string): string {
  return hashSiteKey(rawKey);
}
