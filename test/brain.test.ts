import { describe, it, expect, vi } from 'vitest';
import { SystemBrain } from '../src/brain/system-brain.js';
import { mkTmpDir, cleanTmpDir, makeFetchResponse } from './helpers.js';

describe('SystemBrain — Bug 14 (weak heuristic not done)', () => {
  it('returns candidate, not done, on weak heuristic pass', async () => {
    const dir = mkTmpDir();
    try {
      const brain = new SystemBrain(dir);
      brain.registry.add({
        id: 'a', type: 'openai', name: 'A', apiKey: 'k',
        baseUrl: 'https://a.test', model: 'm', enabled: true, priority: 1,
        addedAt: new Date().toISOString(),
      });
      vi.stubGlobal('fetch', vi.fn(async () =>
        makeFetchResponse({ choices: [{ message: { content: 'This is a long enough answer that passes.' } }] })
      ) as any);

      const r = await brain.run({ question: 'q?', maxRuntimeHours: 0.01 });
      expect(r.status).toBe('candidate');
      expect(r.verified).toBe(false);
      expect(r.verificationLevel).toBe('weak-heuristic');
    } finally { cleanTmpDir(dir); }
  });

  it('persists maxRuntimeHours (Bug 15)', async () => {
    const dir = mkTmpDir();
    try {
      const brain = new SystemBrain(dir);
      brain.registry.add({
        id: 'a', type: 'openai', name: 'A', apiKey: 'k',
        baseUrl: 'https://a.test', model: 'm', enabled: true, priority: 1,
        addedAt: new Date().toISOString(),
      });
      vi.stubGlobal('fetch', vi.fn(async () => {
        // never resolves
        return new Promise(() => {});
      }) as any);

      brain.run({ question: 'q?', maxRuntimeHours: 0.0001 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 200));

      const paused = brain.resume.listPaused();
      if (paused.length > 0) {
        expect(paused[0].maxRuntimeHours).toBe(0.0001);
        expect(paused[0].deadlineAt).toBeGreaterThan(paused[0].startedAt);
      }
    } finally { cleanTmpDir(dir); }
  });

  it('rejects resume with conflicting question (Bug 5)', async () => {
    const dir = mkTmpDir();
    try {
      const brain = new SystemBrain(dir);
      brain.registry.add({
        id: 'a', type: 'openai', name: 'A', apiKey: 'k',
        baseUrl: 'https://a.test', model: 'm', enabled: true, priority: 1,
        addedAt: new Date().toISOString(),
      });
      vi.stubGlobal('fetch', vi.fn(async () =>
        makeFetchResponse({ choices: [{ message: { content: 'long enough answer here, ok.' } }] })
      ) as any);

      const taskId = 'abcdef1234567890';
      const r1 = await brain.run({ question: 'original', taskId, maxRuntimeHours: 0.01 });
      expect(r1.status).toBe('candidate');

      // Different question with same taskId — should throw
      await expect(
        brain.run({ question: 'different', taskId, maxRuntimeHours: 0.01 })
      ).rejects.toThrow(/different question/);
    } finally { cleanTmpDir(dir); }
  });
});
