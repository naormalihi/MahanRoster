/** A request that never reached the server (phone switching networks, a moment offline). */
export function isNetworkError(e: unknown): boolean {
  const m = (e as Error)?.message ?? String(e);
  return /failed to fetch|networkerror|load failed|network request failed/i.test(m);
}

/** Shown when the connection stays down across several polls. */
export const OFFLINE_TEXT = "אין חיבור לשרת – מנסה שוב…";

/**
 * Polling that rides out short network drops: a failed poll is retried on the next tick, and
 * only `after` failures in a row (≈ 12 s at 4 s) surface. Any success clears it.
 */
export function pollFailures(after = 3) {
  let n = 0;
  return {
    ok() {
      n = 0;
    },
    /** the text to show, or null to stay quiet for now */
    fail(e: unknown): string | null {
      if (!isNetworkError(e)) return (e as Error)?.message ?? String(e);
      n += 1;
      return n >= after ? OFFLINE_TEXT : null;
    },
  };
}
