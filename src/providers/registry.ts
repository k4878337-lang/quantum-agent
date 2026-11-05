import fs from 'fs';
import path from 'path';

export type ProviderType = 'openai' | 'claude' | 'gemini' | 'ollama' | 'custom';

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

const REGISTRY_PATH = path.join(process.cwd(), '.quantum-providers.json');

export class ProviderRegistry {
  private providers: ProviderConfig[] = [];

  constructor() {
    this.load();
  }

  load(): void {
    if (fs.existsSync(REGISTRY_PATH)) {
      try {
        this.providers = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
      } catch {
        this.providers = [];
      }
    }
  }

  save(): void {
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(this.providers, null, 2), {
      mode: 0o600,
    });
  }

  add(config: ProviderConfig): void {
    this.providers = this.providers.filter((p) => p.id !== config.id);
    this.providers.push(config);
    this.save();
  }

  remove(id: string): boolean {
    const before = this.providers.length;
    this.providers = this.providers.filter((p) => p.id !== id);
    this.save();
    return this.providers.length < before;
  }

  list(): ProviderConfig[] {
    return [...this.providers].sort((a, b) => a.priority - b.priority);
  }

  /** Providers that are enabled AND have a model selected. */
  getActive(): ProviderConfig[] {
    return this.list().filter((p) => p.enabled && p.model);
  }

  getEnabled(): ProviderConfig[] {
    return this.list().filter((p) => p.enabled);
  }

  find(id: string): ProviderConfig | undefined {
    return this.providers.find((p) => p.id === id);
  }

  setEnabled(id: string, enabled: boolean): void {
    const p = this.find(id);
    if (p) {
      p.enabled = enabled;
      this.save();
    }
  }

  setModel(id: string, model: string): void {
    const p = this.find(id);
    if (p) {
      p.model = model;
      p.connectedAt = new Date().toISOString();
      this.save();
    }
  }
}
