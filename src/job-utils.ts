export function retryDelaySeconds(attempt: number): number {
  return Math.min(300, 5 * (2 ** Math.max(0, attempt - 1)));
}
