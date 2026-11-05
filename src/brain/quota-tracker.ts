import fs from 'fs';
import path from 'path';

export type QuotaState = 'ok' | 'exhausted';

export interface ProviderQuota {
  id: string;
  state: QuotaState;
  cooldownUntil: number;
  lastError?: string;
  exhaustedAt?: number;
}

export class QuotaTracker {
  private map: Record<string, ProviderQuota> = {};
  private readonly filePath: string;

  constructor(baseDir: string = process.cwd()) {
    this.filePath = path.join(baseDir, '.quantum-quota.json');
    this.load();
  }

  private load() {
    if (!fs.existsSync(this.filePath)) return;
    try {
      this.map = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
    } catch {
      this.map = {};
    }
  }

  private save() {
    const tmp = `${this.filePath}.tmp`;
    const data = JSON.stringify(this.map, null, 2);
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.filePath);
  }

  /** Fixes Bug 17: accepts ms (was seconds). */
  markExhausted(id: string, cooldownMs: number, error?: string) {
    this.map[id] = {
      id,
      state: 'exhausted',
      cooldownUntil: Date.now() + cooldownMs,
      lastError: error,
      exhaustedAt: Date.now(),
    };
    this.save();
  }

  markOK(id: string) {
    if (this.map[id]) {
      delete this.map[id];
      this.save();
    }
  }

  isAvailable(id: string): boolean {
    const q = this.map[id];
    if (!q) return true;
    return Date.now() >= q.cooldownUntil;
  }

  allExhausted(ids: string[]): boolean {
    return ids.every((id) => !this.isAvailable(id));
  }

  nextAvailableIn(ids: string[]): number {
    if (ids.some((id) => this.isAvailable(id))) return 0;
    const times = ids.map((id) => this.map[id]?.cooldownUntil ?? 0);
    return Math.max(0, Math.min(...times) - Date.now());
  }

  status(ids: string[]) {
    return ids.map((id) => {
      const q = this.map[id];
      return {
        id,
        state: q?.state ?? 'ok',
        cooldownUntil: q?.cooldownUntil ?? 0,
        lastError: q?.lastError,
        exhaustedAt: q?.exhaustedAt,
        available: this.isAvailable(id),
        cooldown_in_seconds: Math.max(
          0,
          Math.ceil(((q?.cooldownUntil ?? 0) - Date.now()) / 1000)
        ),
      };
    });
  }

  reset() {
    this.map = {};
    this.save();
  }
}
