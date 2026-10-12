export function retryDelaySeconds(attempt: number): number {
  return Math.min(300, 5 * (2 ** Math.max(0, attempt - 1)));
}

export function jobDedupeKey(jobType: string, aggregateId: string): string {
  // Collector ingestion historically creates event.process jobs under event:<id>.
  // All retry/repair paths must use the same key so they repair that row instead of duplicating it.
  return jobType === "event.process"
    ? `event:${aggregateId}`
    : `${jobType}:${aggregateId}`;
}
