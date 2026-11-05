import fs from 'fs';
import path from 'path';

export type ProviderType =
  | 'openai'
  | 'claude'
  | 'gemini'
  | 'ollama'
  | 'deepseek'
  | 'custom';

export interface ProviderConfig {
  id: string;
  type: ProviderType;
  name: string;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  enabled: boolean;
  priority: number;
  addedAt: string;
  connectedAt?: string;
}

/** Public sanitized view — never includes apiKey. */
export interface SafeProviderView {
  id: string;
  type: ProviderType;
  name: string;
  baseUrl?: string;
  model: string;
  enabled: boolean;
  priority: number;
  hasApiKey: boolean;
  connectedAt?: string;
}

const VALID_TYPES: ProviderType[] = [
  'openai', 'claude', 'gemini', 'ollama', 'deepseek', 'custom',
];

export class ProviderRegistry {
  private providers: ProviderConfig[] = [];
  private readonly filePath: string;

  constructor(baseDir: string = process.cwd()) {
    this.filePath = path.join(baseDir, '.quantum-providers.json');
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('not an array');

      const valid: ProviderConfig[] = [];
      for (const p of parsed) {
        if (this.isValid(p)) valid.push(this.normalize(p));
        else console.error(`[registry] skipping invalid entry: ${JSON.stringify(p).slice(0, 100)}`);
      }
      this.providers = valid;
    } catch (err: any) {
      // ⭐ Bug 13 FIX: quarantine, don't overwrite
      const backup = `${this.filePath}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(this.filePath, backup);
        console.error(`[registry] CORRUPT — quarantined to ${backup}. Starting empty.`);
        console.error(`[registry] Restore manually: mv ${backup} ${this.filePath}`);
      } catch {
        console.error(`[registry] CORRUPT and quarantine failed: ${err.message}`);
      }
      this.providers = [];
    }
  }

  private normalize(p: any): ProviderConfig {
    return {
      id: String(p.id),
      type: p.type,
      name: String(p.name),
      apiKey: typeof p.apiKey === 'string' ? p.apiKey : undefined,
      baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl : undefined,
      model: String(p.model || ''),
      enabled: !!p.enabled,
      priority: Number.isFinite(p.priority) ? p.priority : 10,
      addedAt: String(p.addedAt || new Date().toISOString()),
      connectedAt: typeof p.connectedAt === 'string' ? p.connectedAt : undefined,
    };
  }

  private isValid(p: any): boolean {
    if (!p || typeof p !== 'object') return false;
    if (typeof p.id !== 'string' || p.id.length === 0) return false;
    if (!VALID_TYPES.includes(p.type)) return false;
    if (typeof p.name !== 'string') return false;
    if (typeof p.priority !== 'number' || !Number.isFinite(p.priority)) return false;
    return true;
  }

  private atomicSave(): void {
    const tmp = `${this.filePath}.tmp`;
    const data = JSON.stringify(this.providers, null, 2);
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.filePath);
    // Parent fsync for rename durability
    try {
      const dirFd = fs.openSync(path.dirname(this.filePath), 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch { /* best-effort on non-POSIX */ }
  }

  add(config: ProviderConfig): void {
    this.providers = this.providers.filter((p) => p.id !== config.id);
    this.providers.push(config);
    this.atomicSave();
  }

  remove(id: string): boolean {
    const before = this.providers.length;
    this.providers = this.providers.filter((p) => p.id !== id);
    if (this.providers.length < before) this.atomicSave();
    return this.providers.length < before;
  }

  list(): ProviderConfig[] {
    return [...this.providers].sort((a, b) => a.priority - b.priority);
  }

  /** ⭐ Bug 12 FIX: safe view only, no apiKey */
  listSafe(): SafeProviderView[] {
    return this.list().map((p) => ({
      id: p.id,
      type: p.type,
      name: p.name,
      baseUrl: p.baseUrl,
      model: p.model,
      enabled: p.enabled,
      priority: p.priority,
      hasApiKey: !!p.apiKey,
      connectedAt: p.connectedAt,
    }));
  }

  getActive(): ProviderConfig[] {
    return this.list().filter((p) => p.enabled && p.model);
  }

  getEnabled(): ProviderConfig[] {
    return this.list().filter((p) => p.enabled);
  }

  find(id: string): ProviderConfig | undefined {
    const p = this.providers.find((x) => x.id === id);
    return p ? { ...p } : undefined;
  }

  setEnabled(id: string, enabled: boolean): void {
    const p = this.providers.find((x) => x.id === id);
    if (p) {
      p.enabled = enabled;
      this.atomicSave();
    }
  }

  setModel(id: string, model: string): void {
    const p = this.providers.find((x) => x.id === id);
    if (p) {
      p.model = model;
      p.connectedAt = new Date().toISOString();
      this.atomicSave();
    }
  }
}
