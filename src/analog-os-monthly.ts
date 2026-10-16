import { db } from "./db.js";
import {
  getLondonMonthKey,
  getPreviousLondonMonthKey,
  getReadOnlyAnalogOSMonth,
  validateReconciliationMonth,
  type AnalogOSLead,
  type AnalogOSMonthExport
} from "./analog-os-reconciliation.js";

type StoredMonthRow = {
  month_key: string;
  generated_at: string | Date;
  refreshed_at: string | Date;
  days_queried: number;
  lead_count: number;
  counts: AnalogOSMonthExport["counts"] | string;
  leads: AnalogOSLead[] | string;
};

export type AnalogOSMonthlySnapshot = {
  month: string;
  generated_at: string;
  refreshed_at: string;
  days_queried: number;
  lead_count: number;
  counts: AnalogOSMonthExport["counts"];
  leads: AnalogOSLead[];
  read_only: true;
  cached: boolean;
  stale?: boolean;
};

function parseJson<T>(value: T | string, fallback: T): T {
  if (typeof value !== "string") return value ?? fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function serializeStored(row: StoredMonthRow, cached: boolean, stale = false): AnalogOSMonthlySnapshot {
  return {
    month: row.month_key,
    generated_at: new Date(row.generated_at).toISOString(),
    refreshed_at: new Date(row.refreshed_at).toISOString(),
    days_queried: Number(row.days_queried || 0),
    lead_count: Number(row.lead_count || 0),
    counts: parseJson(row.counts, { total: 0, whatconverts: 0, email: 0 }),
    leads: parseJson(row.leads, []),
    read_only: true,
    cached,
    ...(stale ? { stale: true } : {})
  };
}

export async function readAnalogOSMonthSnapshot(monthInput: string): Promise<AnalogOSMonthlySnapshot | null> {
  const month = validateReconciliationMonth(monthInput);
  const result = await db.query(
    "SELECT month_key,generated_at,refreshed_at,days_queried,lead_count,counts,leads " +
    "FROM analog_os_monthly_snapshots WHERE month_key=$1 LIMIT 1",
    [month]
  );
  return result.rowCount ? serializeStored(result.rows[0] as StoredMonthRow, true) : null;
}

/** Store one complete signed month export in a dedicated archive table. */
export async function refreshAnalogOSMonthSnapshot(
  monthInput: string,
  now = new Date()
): Promise<AnalogOSMonthlySnapshot> {
  const month = validateReconciliationMonth(monthInput);
  if (month > getLondonMonthKey(now)) throw new Error("future_month_not_allowed");

  const exportData = await getReadOnlyAnalogOSMonth(month, now);
  const result = await db.query(
    `INSERT INTO analog_os_monthly_snapshots
      (month_key,generated_at,refreshed_at,days_queried,lead_count,counts,leads,updated_at)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,NOW())
     ON CONFLICT(month_key) DO UPDATE SET
       generated_at=EXCLUDED.generated_at,
       refreshed_at=EXCLUDED.refreshed_at,
       days_queried=EXCLUDED.days_queried,
       lead_count=EXCLUDED.lead_count,
       counts=EXCLUDED.counts,
       leads=EXCLUDED.leads,
       updated_at=NOW()
     RETURNING month_key,generated_at,refreshed_at,days_queried,lead_count,counts,leads`,
    [
      exportData.month,
      exportData.generated_at,
      exportData.refreshed_at,
      exportData.days_queried,
      exportData.leads.length,
      JSON.stringify(exportData.counts),
      JSON.stringify(exportData.leads)
    ]
  );
  return serializeStored(result.rows[0] as StoredMonthRow, false);
}

/**
 * Normal reads use the cached snapshot. A missing month is loaded once; the
 * dashboard's explicit Refresh button is the safe way to refresh it sooner.
 * A failed refresh preserves a previous good snapshot instead of replacing it
 * with partial data.
 */
export async function getAnalogOSMonthlySnapshot(
  monthInput: string,
  options: { refresh?: boolean; now?: Date } = {}
): Promise<AnalogOSMonthlySnapshot> {
  const now = options.now ?? new Date();
  const month = validateReconciliationMonth(monthInput);
  if (month > getLondonMonthKey(now)) throw new Error("future_month_not_allowed");
  const existing = await readAnalogOSMonthSnapshot(month);
  if (!options.refresh && existing) return existing;
  try {
    return await refreshAnalogOSMonthSnapshot(month, now);
  } catch (error) {
    if (existing) return { ...existing, cached: true, stale: true };
    throw error;
  }
}

/**
 * Worker safety net: refresh the prior completed month once after month rollover,
 * then ensure a current-month snapshot exists. The archive never writes into the
 * live leads table and never queues notifications.
 */
export async function ensureMonthlyAnalogOSSnapshots(now = new Date()): Promise<void> {
  const currentMonth = getLondonMonthKey(now);
  const previousMonth = getPreviousLondonMonthKey(now);
  const monthStart = new Date(currentMonth + "-01T00:00:00.000Z").getTime();

  const previous = await readAnalogOSMonthSnapshot(previousMonth);
  if (!previous || new Date(previous.refreshed_at).getTime() < monthStart) {
    await refreshAnalogOSMonthSnapshot(previousMonth, now);
  }

  const current = await readAnalogOSMonthSnapshot(currentMonth);
  if (!current) await refreshAnalogOSMonthSnapshot(currentMonth, now);
}
