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

const QUOTA_FILE = path.join(process.cwd(), '.quantum-quota.json');

export class QuotaTracker {
  private map: Record<string, ProviderQuota> = {};

  constructor() {
    this.load();
  }

  private load() {
    if (fs.existsSync(QUOTA_FILE)) {
      try {
        this.map = JSON.parse(fs.readFileSync(QUOTA_FILE, 'utf-8'));
      } catch {
        this.map = {};
      }
    }
  }

  private save() {
    fs.writeFileSync(QUOTA_FILE, JSON.stringify(this.map, null, 2));
  }

  markExhausted(id: string, retryAfterSec = 60, error?: string) {
    this.map[id] = {
      id,
      state: 'exhausted',
      cooldownUntil: Date.now() + retryAfterSec * 1000,
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

  allExhausted(providerIds: string[]): boolean {
    return providerIds.every((id) => !this.isAvailable(id));
  }

  nextAvailableIn(providerIds: string[]): number {
    const available = providerIds.filter((id) => this.isAvailable(id));
    if (available.length > 0) return 0;
    const times = providerIds.map((id) => this.map[id]?.cooldownUntil ?? 0);
    return Math.max(0, Math.min(...times) - Date.now());
  }

  status(providerIds: string[]) {
    return providerIds.map((id) => {
      const q = this.map[id];
      return {
        id,
        state: q?.state || 'ok',
        cooldownUntil: q?.cooldownUntil || 0,
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
