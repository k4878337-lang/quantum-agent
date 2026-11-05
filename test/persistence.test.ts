import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ResumeManager } from '../src/brain/resume.js';
import { acquireTaskLock } from '../src/brain/task-lock.js';
import { mkTmpDir, cleanTmpDir } from './helpers.js';

function makeCp(taskId: string, overrides: any = {}) {
  return {
    version: '1.1' as const,
    taskId,
    question: 'test question',
    mode: 'medium',
    maxRuntimeHours: 24,
    deadlineAt: Date.now() + 24 * 3600 * 1000,
    startedAt: Date.now(),
    lastUpdate: Date.now(),
    elapsedSeconds: 0,
    round: 0,
    status: 'running' as const,
    verificationLevel: 'none' as const,
    ...overrides,
  };
}

describe('ResumeManager — Bug 9, 10', () => {
  it('round-trips valid checkpoint', () => {
    const dir = mkTmpDir();
    try {
      const m = new ResumeManager(dir);
      const cp = makeCp('abcdef1234567890');
      m.save(cp);
      const loaded = m.load(cp.taskId);
      expect(loaded?.question).toBe('test question');
    } finally { cleanTmpDir(dir); }
  });

  it('rejects tampered checkpoint (checksum)', () => {
    const dir = mkTmpDir();
    try {
      const m = new ResumeManager(dir);
      const cp = makeCp('abcdef1234567890');
      m.save(cp);
      const file = m.pathFor(cp.taskId);
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      data.question = 'tampered';
      fs.writeFileSync(file, JSON.stringify(data));
      expect(m.load(cp.taskId)).toBeNull();
    } finally { cleanTmpDir(dir); }
  });

  it('rejects missing checksum (Bug 9)', () => {
    const dir = mkTmpDir();
    try {
      const m = new ResumeManager(dir);
      const cp = makeCp('abcdef1234567890');
      m.save(cp);
      const file = m.pathFor(cp.taskId);
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      delete data.checksum;
      fs.writeFileSync(file, JSON.stringify(data));
      expect(m.load(cp.taskId)).toBeNull();
    } finally { cleanTmpDir(dir); }
  });

  it('rejects missing signature (Bug 9)', () => {
    const dir = mkTmpDir();
    try {
      const m = new ResumeManager(dir);
      const cp = makeCp('abcdef1234567890');
      m.save(cp);
      const file = m.pathFor(cp.taskId);
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      delete data.signature;
      fs.writeFileSync(file, JSON.stringify(data));
      expect(m.load(cp.taskId)).toBeNull();
    } finally { cleanTmpDir(dir); }
  });

  it('rejects invalid task ID (path traversal)', () => {
    const dir = mkTmpDir();
    try {
      const m = new ResumeManager(dir);
      expect(() => m.load('../evil')).toThrow();
    } finally { cleanTmpDir(dir); }
  });

  it('preserves corrupt file as backup', () => {
    const dir = mkTmpDir();
    try {
      const m = new ResumeManager(dir);
      const cp = makeCp('abcdef1234567890');
      m.save(cp);
      const file = m.pathFor(cp.taskId);
      fs.writeFileSync(file, 'not-json');
      expect(m.load(cp.taskId)).toBeNull();
      const files = fs.readdirSync(path.join(dir, '.quantum-checkpoints'));
      expect(files.some((f) => f.includes('.corrupt-'))).toBe(true);
    } finally { cleanTmpDir(dir); }
  });
});

describe('TaskLock — Bug 7', () => {
  it('allows single acquire', () => {
    const dir = mkTmpDir();
    try {
      const lock = acquireTaskLock('abcdef1234567890', dir);
      expect(lock).toBeDefined();
      lock.release();
    } finally { cleanTmpDir(dir); }
  });

  it('second acquire fails while first held', () => {
    const dir = mkTmpDir();
    try {
      const lock = acquireTaskLock('abcdef1234567890', dir);
      expect(() => acquireTaskLock('abcdef1234567890', dir)).toThrow(/locked/);
      lock.release();
    } finally { cleanTmpDir(dir); }
  });

  it('steals stale lock (dead PID)', () => {
    const dir = mkTmpDir();
    try {
      fs.mkdirSync(path.join(dir, '.quantum-locks'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.quantum-locks', 'abcdef1234567890.lock'),
        JSON.stringify({ pid: 999999, startedAt: Date.now() })
      );
      const lock = acquireTaskLock('abcdef1234567890', dir);
      expect(lock).toBeDefined();
      lock.release();
    } finally { cleanTmpDir(dir); }
  });
});
