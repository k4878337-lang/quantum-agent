import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderRegistry } from '../src/providers/registry.js';
import { ProviderController, ProviderError } from '../src/providers/controller.js';
import { QuotaTracker } from '../src/brain/quota-tracker.js';
import { parseRetryAfterMs } from '../src/utils/retry.js';
import { mkTmpDir, cleanTmpDir, makeFetchResponse } from './helpers.js';

function freshSetup() {
  const dir = mkTmpDir();
  const registry = new ProviderRegistry(dir);
  const quota = new QuotaTracker(dir);
  const controller = new ProviderController(registry, quota);
  return { dir, registry, quota, controller };
}

describe('ProviderController', () => {
  it('skips excluded providers (Bug 4)', async () => {
    const { dir, registry, controller } = freshSetup();
    try {
      registry.add({
        id: 'bad', type: 'openai', name: 'Bad', apiKey: 'k',
        baseUrl: 'https://bad.test', model: 'm', enabled: true, priority: 1,
        addedAt: new Date().toISOString(),
      });
      registry.add({
        id: 'good', type: 'openai', name: 'Good', apiKey: 'k',
        baseUrl: 'https://good.test', model: 'm', enabled: true, priority: 2,
        addedAt: new Date().toISOString(),
      });

      const calls: string[] = [];
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes('bad.test')) {
          const err: any = new Error('unauthorized');
          err.status = 401;
          throw err;
        }
        return makeFetchResponse({ choices: [{ message: { content: 'ok' } }] });
      }) as any);

      // First round: bad gets tried, fails, good succeeds
      const r1 = await controller.complete('x', undefined);
      expect(r1.provider).toBe('good');
      expect(calls.some((c) => c.includes('bad.test'))).toBe(true);

      // Second round with exclusion: bad NOT tried
      calls.length = 0;
      const r2 = await controller.complete('x', undefined, { excludeProviderIds: new Set(['bad']) });
      expect(r2.provider).toBe('good');
      expect(calls.some((c) => c.includes('bad.test'))).toBe(false);
    } finally { cleanTmpDir(dir); }
  });

  it('marks 429 provider exhausted and skips in next round (Bug 2)', async () => {
    const { dir, registry, quota, controller } = freshSetup();
    try {
      registry.add({
        id: 'a', type: 'openai', name: 'A', apiKey: 'k',
        baseUrl: 'https://a.test', model: 'm', enabled: true, priority: 1,
        addedAt: new Date().toISOString(),
      });
      registry.add({
        id: 'b', type: 'openai', name: 'B', apiKey: 'k',
        baseUrl: 'https://b.test', model: 'm', enabled: true, priority: 2,
        addedAt: new Date().toISOString(),
      });

      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url.includes('a.test')) {
          const r = makeFetchResponse('rate limited', 429, { 'retry-after': '60' });
          return r;
        }
        return makeFetchResponse({ choices: [{ message: { content: 'from-b' } }] });
      }) as any);

      const r = await controller.complete('x', undefined);
      expect(r.provider).toBe('b');
      expect(quota.isAvailable('a')).toBe(false);
      expect(quota.isAvailable('b')).toBe(true);
    } finally { cleanTmpDir(dir); }
  });

  it('respects preferredId first (Bug 4)', async () => {
    const { dir, registry, controller } = freshSetup();
    try {
      registry.add({
        id: 'a', type: 'openai', name: 'A', apiKey: 'k',
        baseUrl: 'https://a.test', model: 'm', enabled: true, priority: 1,
        addedAt: new Date().toISOString(),
      });
      registry.add({
        id: 'b', type: 'openai', name: 'B', apiKey: 'k',
        baseUrl: 'https://b.test', model: 'm', enabled: true, priority: 2,
        addedAt: new Date().toISOString(),
      });

      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        const from = url.includes('a.test') ? 'a' : 'b';
        return makeFetchResponse({ choices: [{ message: { content: `from-${from}` } }] });
      }) as any);

      const r = await controller.complete('x', undefined, { preferredId: 'b' });
      expect(r.provider).toBe('b');
    } finally { cleanTmpDir(dir); }
  });

  it('preferred failure triggers fallback (Bug 4)', async () => {
    const { dir, registry, controller } = freshSetup();
    try {
      registry.add({
        id: 'a', type: 'openai', name: 'A', apiKey: 'k',
        baseUrl: 'https://a.test', model: 'm', enabled: true, priority: 1,
        addedAt: new Date().toISOString(),
      });
      registry.add({
        id: 'b', type: 'openai', name: 'B', apiKey: 'k',
        baseUrl: 'https://b.test', model: 'm', enabled: true, priority: 2,
        addedAt: new Date().toISOString(),
      });

      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url.includes('b.test')) {
          const r = makeFetchResponse('oops', 500);
          return r;
        }
        return makeFetchResponse({ choices: [{ message: { content: 'from-a' } }] });
      }) as any);

      const r = await controller.complete('x', undefined, { preferredId: 'b' });
      expect(r.provider).toBe('a');
    } finally { cleanTmpDir(dir); }
  });

  it('success of one provider does not reset another (Bug 3)', async () => {
    const { dir, registry, quota, controller } = freshSetup();
    try {
      registry.add({
        id: 'a', type: 'openai', name: 'A', apiKey: 'k',
        baseUrl: 'https://a.test', model: 'm', enabled: true, priority: 1,
        addedAt: new Date().toISOString(),
      });
      registry.add({
        id: 'b', type: 'openai', name: 'B', apiKey: 'k',
        baseUrl: 'https://b.test', model: 'm', enabled: true, priority: 2,
        addedAt: new Date().toISOString(),
      });
      quota.markExhausted('a', 60_000);

      vi.stubGlobal('fetch', vi.fn(async () =>
        makeFetchResponse({ choices: [{ message: { content: 'from-b' } }] })
      ) as any);

      const r = await controller.complete('x', undefined);
      expect(r.provider).toBe('b');
      expect(quota.isAvailable('a')).toBe(false); // A still exhausted
      expect(quota.isAvailable('b')).toBe(true);
    } finally { cleanTmpDir(dir); }
  });
});

describe('parseRetryAfterMs (Bug 17)', () => {
  it('parses numeric seconds', () => {
    expect(parseRetryAfterMs('60')).toBe(60_000);
    expect(parseRetryAfterMs('0')).toBe(0);
  });

  it('parses HTTP date', () => {
    const future = new Date(Date.now() + 30_000).toUTCString();
    const ms = parseRetryAfterMs(future);
    expect(ms).toBeGreaterThan(25_000);
    expect(ms).toBeLessThan(35_000);
  });

  it('returns null for garbage', () => {
    expect(parseRetryAfterMs('garbage')).toBeNull();
    expect(parseRetryAfterMs(null)).toBeNull();
  });
});
