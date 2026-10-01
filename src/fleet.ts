import { normalizePhone } from "./utils/phone.js";

export type FleetSite = {
  hostname: string;
  name: string;
  trackingNumbers: string[];
};

const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function normalizeHostname(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid_hostname");
  const hostname = value.trim().toLowerCase().replace(/\.$/, "");
  const labels = hostname.split(".");
  if (labels.length < 2 || hostname.length > 253 || labels.some((label) => !HOSTNAME_LABEL.test(label))) {
    throw new Error("invalid_hostname");
  }
  return hostname;
}

function normalizeTrackingNumbers(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("invalid_tracking_numbers");
  const numbers = value.map((item) => normalizePhone(typeof item === "string" ? item.trim() : null));
  if (numbers.some((number) => !number)) throw new Error("invalid_tracking_number");
  const normalized = numbers as string[];
  if (new Set(normalized).size !== normalized.length) throw new Error("duplicate_tracking_number");
  return normalized;
}

export function normalizeFleetSites(payload: unknown): FleetSite[] {
  const body = payload as { sites?: unknown };
  if (!body || !Array.isArray(body.sites) || body.sites.length === 0) {
    throw new Error("sites_required");
  }
  if (body.sites.length > 200) throw new Error("too_many_sites");

  const seenHostnames = new Set<string>();
  const seenTrackingNumbers = new Set<string>();
  const result: FleetSite[] = [];

  for (const item of body.sites) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("invalid_site");
    const row = item as Record<string, unknown>;
    const hostname = normalizeHostname(row.hostname);
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!name) throw new Error("name_required");
    if (name.length > 200) throw new Error("name_too_long");
    if (seenHostnames.has(hostname)) throw new Error("duplicate_hostname");
    const trackingNumbers = normalizeTrackingNumbers(row.tracking_numbers);
    for (const number of trackingNumbers) {
      if (seenTrackingNumbers.has(number)) throw new Error("duplicate_tracking_number");
      seenTrackingNumbers.add(number);
    }
    seenHostnames.add(hostname);
    result.push({ hostname, name, trackingNumbers });
  }

  return result;
}
