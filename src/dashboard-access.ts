export function normalizeDashboardEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAllowedDashboardEmail(
  email: string,
  allowedEmails: string,
  allowAnyAuthenticatedUser: boolean
): boolean {
  const normalized = normalizeDashboardEmail(email);
  if (!normalized) return false;
  if (allowAnyAuthenticatedUser) return true;
  const allowed = allowedEmails
    .split(",")
    .map(normalizeDashboardEmail)
    .filter(Boolean);
  return allowed.includes(normalized);
}
