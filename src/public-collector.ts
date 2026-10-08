import { db } from "./db.js";
import { config } from "./config.js";
import { generateSiteKey, hashGeneratedSiteKey } from "./auth.js";

export function canonicalCollectorHostname(value: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw.includes("://") ? raw : "https://" + raw);
    return parsed.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

export function parseCollectorHostAllowlist(value: string): string[] {
  return [...new Set(
    String(value ?? "")
      .split(",")
      .map(canonicalCollectorHostname)
      .filter(Boolean)
  )];
}

export function isAllowedCollectorHostname(hostname: string): boolean {
  const canonical = canonicalCollectorHostname(hostname);
  if (!canonical) return false;
  return parseCollectorHostAllowlist(config.ANALOG_PUBLIC_COLLECTOR_HOSTS).includes(canonical);
}

export function isAllowedCollectorOrigin(origin: string | undefined, hostname: string): boolean {
  if (!origin) return false;
  const expected = canonicalCollectorHostname(hostname);
  if (!expected) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:" && parsed.hostname.toLowerCase().replace(/\.$/, "") === expected;
  } catch {
    return false;
  }
}

export async function resolvePublicCollectorSite(hostname: string) {
  const canonical = canonicalCollectorHostname(hostname);
  if (!canonical || !isAllowedCollectorHostname(canonical)) return null;

  const existing = await db.query(
    "SELECT id,hostname,name,status FROM sites WHERE hostname=$1 LIMIT 1",
    [canonical]
  );
  if (existing.rowCount) {
    const site = existing.rows[0];
    return site.status === "active" ? site : null;
  }

  const siteName = canonical;
  const generatedKey = generateSiteKey();
  try {
    const result = await db.query(
      "INSERT INTO sites(site_key_hash,hostname,name,status) VALUES($1,$2,$3,'active') RETURNING id,hostname,name,status",
      [hashGeneratedSiteKey(generatedKey), canonical, siteName]
    );
    return result.rows[0];
  } catch (error) {
    if ((error as { code?: string }).code !== "23505") throw error;
    const retry = await db.query(
      "SELECT id,hostname,name,status FROM sites WHERE hostname=$1 LIMIT 1",
      [canonical]
    );
    const site = retry.rows[0] ?? null;
    return site?.status === "active" ? site : null;
  }
}
