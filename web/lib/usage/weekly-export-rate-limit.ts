// In-memory per-admin rate limiter for the weekly export endpoint.
// Single-process assumption: Next.js standalone deploys typically run a
// single admin instance. With N replicas, the window scales to N * RATE_LIMIT_MS.
export const RATE_LIMIT_MS = 30_000;

const lastExportAt = new Map<string, number>();

export function checkAndRecord(
  adminId: string,
  now: () => number = () => Date.now(),
): boolean {
  const ts = now();
  const last = lastExportAt.get(adminId);
  if (last !== undefined && ts - last < RATE_LIMIT_MS) return false;
  lastExportAt.set(adminId, ts);
  return true;
}

// Test hook — clears the in-memory map. Not for production use.
export function __resetRateLimitForTest(): void {
  lastExportAt.clear();
}
