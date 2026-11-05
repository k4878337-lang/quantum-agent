import fs from 'fs';
import path from 'path';

/**
 * Atomic file-based task lock. Fixes Bug 7.
 * Stale-lock recovery: if PID is dead, lock is stolen.
 */
export interface TaskLock {
  release(): void;
}

interface LockContent {
  pid: number;
  startedAt: number;
  hostname?: string;
}

function isPidAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err.code === 'EPERM';
  }
}

export function acquireTaskLock(taskId: string, baseDir: string = process.cwd()): TaskLock {
  const lockDir = path.join(baseDir, '.quantum-locks');
  fs.mkdirSync(lockDir, { recursive: true });
  const lockPath = path.join(lockDir, `${taskId}.lock`);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      const content: LockContent = {
        pid: process.pid,
        startedAt: Date.now(),
        hostname: process.env.HOSTNAME,
      };
      try {
        fs.writeSync(fd, JSON.stringify(content));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }

      let released = false;
      return {
        release: () => {
          if (released) return;
          released = true;
          try {
            const current = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as LockContent;
            if (current.pid === process.pid) fs.unlinkSync(lockPath);
          } catch {
            /* already gone */
          }
        },
      };
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err;

      // Lock exists — check if stale
      let content: LockContent | null = null;
      try {
        content = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      } catch {
        content = null;
      }

      const stale =
        !content ||
        typeof content.pid !== 'number' ||
        !isPidAlive(content.pid);

      if (stale) {
        const staleBackup = `${lockPath}.stale-${Date.now()}`;
        try {
          fs.renameSync(lockPath, staleBackup);
          console.error(`[lock] ${taskId}: stole stale lock (pid=${content?.pid ?? 'unknown'}) → ${staleBackup}`);
          continue; // retry
        } catch {
          continue;
        }
      }
      throw new Error(`Task ${taskId} locked by PID ${content!.pid}`);
    }
  }
  throw new Error(`Task ${taskId}: could not acquire lock after retries`);
}
