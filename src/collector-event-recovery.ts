const MISSING_UTM_COLUMN_ERROR =
  /column\s+(?:[a-z_][a-z0-9_]*\.)?["']?utm_(?:source|campaign)["']?\s+does not exist/i;

export function isRecoverableCollectorEventSchemaMismatch(
  jobType: string,
  status: string,
  lastError: string | null | undefined
): boolean {
  if (jobType !== "event.process" || status !== "dead_letter") return false;
  return MISSING_UTM_COLUMN_ERROR.test(String(lastError ?? ""));
}
