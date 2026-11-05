/**
 * Network safety + timeout helpers.
 * Fixes: Bug 2 (redirect), Bug 6 (timeout), Bug 11 (SSRF), Bug 18 (body timeout), Addition A & C.
 */

const PRIVATE_V4 = [
  { net: '10.0.0.0', bits: 8 },
  { net: '172.16.0.0', bits: 12 },
  { net: '192.168.0.0', bits: 16 },
  { net: '127.0.0.0', bits: 8 },
  { net: '169.254.0.0', bits: 16 },
  { net: '0.0.0.0', bits: 8 },
];

function ipToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const x = parseInt(p, 10);
    if (isNaN(x) || x < 0 || x > 255) return null;
    n = (n << 8) + x;
  }
  return n >>> 0;
}

function isPrivateV4(ip: string): boolean {
  const n = ipToInt(ip);
  if (n === null) return false;
  for (const { net, bits } of PRIVATE_V4) {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    const netN = ipToInt(net);
    if (netN === null) continue;
    if ((n & mask) === (netN & mask)) return true;
  }
  return false;
}

export function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0') return true;
  if (h.endsWith('.localhost')) return true;
  if (h === 'metadata.google.internal' || h === 'metadata') return true;
  if (isPrivateV4(h)) return true;
  // IPv6 loopback / fc00::/7 / fe80::/10 basic
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) {
    if (h.includes(':')) return true;
  }
  return false;
}

export interface SafeFetchOptions {
  /** Revalidate each redirect hop. */
  validateUrl?: (url: URL) => void;
  /** Block private / reserved targets. Default: true. */
  blockPrivate?: boolean;
  /** Max redirects. Default: 5. */
  maxHops?: number;
  /** Total timeout in ms. Default: 60_000. */
  timeoutMs?: number;
  /** Optional abort signal (task deadline). */
  signal?: AbortSignal;
}

/**
 * fetch() with: (a) AbortSignal.timeout covering body, (b) manual redirects
 * validated at every hop, (c) private-IP blocking.
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  opts: SafeFetchOptions = {}
): Promise<Response> {
  const maxHops = opts.maxHops ?? 5;
  const blockPrivate = opts.blockPrivate ?? true;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = opts.signal
    ? AbortSignal.any([deadline, opts.signal])
    : deadline;

  let current = new URL(url);

  for (let hop = 0; hop <= maxHops; hop++) {
    if (blockPrivate && isPrivateHostname(current.hostname)) {
      throw new Error(`BLOCKED: private/reserved host ${current.hostname}`);
    }
    if (current.username || current.password) {
      throw new Error('BLOCKED: URL contains credentials');
    }
    if (opts.validateUrl) opts.validateUrl(current);

    const res = await fetch(current.toString(), {
      ...init,
      redirect: 'manual',
      signal,
    });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`Redirect ${res.status} without Location`);
      current = new URL(loc, current);
      continue;
    }
    return res;
  }
  throw new Error(`Too many redirects (${maxHops})`);
}

/** fetch + read body inside timeout scope. Fixes Bug 18. */
export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  opts: SafeFetchOptions = {}
): Promise<T> {
  const res = await safeFetch(url, init, opts);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err: any = new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    err.headers = Object.fromEntries(res.headers.entries());
    throw err;
  }
  return (await res.json()) as T;
}
