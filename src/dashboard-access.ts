export type DashboardAccessDenialReason = "access_not_configured" | "email_not_verified";

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

export function getDashboardAccessMessage(
  email: string,
  reason: DashboardAccessDenialReason
): string {
  const account = normalizeDashboardEmail(email) || "this account";
  return reason === "email_not_verified"
    ? "Authenticated as " + account + ", but the email address is not verified."
    : "Authenticated as " + account + ", but this account is not authorized for dashboard access.";
}
