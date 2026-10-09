export type AnalogOSRecoveryJob = {
  status: string | null | undefined;
  attempts?: number | string | null;
  maxAttempts?: number | string | null;
  availableAt?: Date | string | number | null;
  updatedAt?: Date | string | number | null;
};

export const ANALOG_OS_DEAD_LETTER_COOLDOWN_MS = 60 * 60 * 1000;

function timestampMs(value: Date | string | number | null | undefined): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Recovers only queued outbox items that lack a live job or have a job
 * eligible for repair. A dead-letter job is retried after a one-hour cooldown.
 */
export function shouldRecoverAnalogOSEvent(
  outboxStatus: string,
  job: AnalogOSRecoveryJob | null | undefined,
  nowMs = Date.now()
): boolean {
  if (outboxStatus !== "queued") return false;
  if (!job?.status) return true;

  if (job.status === "queued" || job.status === "processing") return false;
  if (job.status === "completed") return true;

  const attempts = Number(job.attempts ?? 0);
  const maxAttempts = Number(job.maxAttempts ?? 0);
  const availableAt = timestampMs(job.availableAt);

  if (job.status === "failed" && attempts < maxAttempts) {
    return availableAt === null || availableAt <= nowMs;
  }

  const updatedAt = timestampMs(job.updatedAt);
  return (
    job.status === "dead_letter" ||
    (job.status === "failed" && attempts >= maxAttempts)
  ) && (updatedAt === null || updatedAt <= nowMs - ANALOG_OS_DEAD_LETTER_COOLDOWN_MS);
}
