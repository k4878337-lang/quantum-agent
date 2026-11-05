/**
 * Retry-After parser supporting both formats. Fixes Bug 17.
 * Numeric seconds: "60"      -> 60_000 ms
 * HTTP date: "Wed, 21 Oct 2015 07:28:00 GMT" -> ms until that time
 */
export function parseRetryAfterMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();

  // Pure integer seconds
  if (/^\d+$/.test(trimmed)) {
    const sec = parseInt(trimmed, 10);
    return sec * 1000;
  }

  // HTTP-date
  const ts = Date.parse(trimmed);
  if (!isNaN(ts)) {
    return Math.max(0, ts - Date.now());
  }

  return null;
}

/** Extract Retry-After from common error shapes (axios, SDK, fetch). */
export function extractRetryAfterMs(err: any): number | null {
  const header =
    err?.response?.headers?.['retry-after'] ??
    err?.headers?.['retry-after'] ??
    err?.response?.headers?.get?.('retry-after') ??
    err?.headers?.get?.('retry-after') ??
    null;
  return parseRetryAfterMs(typeof header === 'string' ? header : null);
}
