import { ProviderConfig } from './registry.js';
import { fetchJson } from '../utils/net.js';

export interface AvailableModel {
  id: string;
  provider: string;
  name: string;
  contextWindow?: number;
  createdAt?: string;
  raw?: any;
}

const TIMEOUT_MS = 20_000;

export class ModelDiscovery {
  async list(provider: ProviderConfig): Promise<AvailableModel[]> {
    switch (provider.type) {
      case 'openai':
        return this.listOpenAI(provider, 'https://api.openai.com/v1');
      case 'deepseek':
        return this.listOpenAI(provider, 'https://api.deepseek.com');
      case 'custom':
        if (!provider.baseUrl) throw new Error('custom provider requires baseUrl');
        return this.listOpenAI(provider, provider.baseUrl);
      case 'claude':
        return this.listAnthropic(provider);
      case 'gemini':
        return this.listGemini(provider);
      case 'ollama':
        return this.listOllama(provider);
      default:
        throw new Error(`Unknown provider type: ${(provider as any).type}`);
    }
  }

  private async listOpenAI(p: ProviderConfig, fallbackBase: string): Promise<AvailableModel[]> {
    const baseUrl = (p.baseUrl || fallbackBase).replace(/\/$/, '');
    if (!p.apiKey) throw new Error('API key missing');
    const json = await fetchJson<{ data?: any[] }>(
      `${baseUrl}/models`,
      { headers: { Authorization: `Bearer ${p.apiKey}` } },
      { timeoutMs: TIMEOUT_MS }
    );
    const data = Array.isArray(json.data) ? json.data : [];
    return data
      .filter((m) => this.isChatModel(m?.id))
      .map((m) => ({
        id: m.id,
        provider: p.id,
        name: m.id,
        createdAt: m.created ? new Date(m.created * 1000).toISOString() : undefined,
        raw: m,
      }));
  }

  private async listAnthropic(p: ProviderConfig): Promise<AvailableModel[]> {
    if (!p.apiKey) throw new Error('API key missing');
    const results: AvailableModel[] = [];
    let afterId: string | undefined;

    for (let page = 0; page < 20; page++) {
      const url = new URL('https://api.anthropic.com/v1/models');
      url.searchParams.set('limit', '100');
      if (afterId) url.searchParams.set('after_id', afterId);

      const json = await fetchJson<{ data?: any[]; has_more?: boolean; last_id?: string }>(
        url.toString(),
        {
          headers: {
            'x-api-key': p.apiKey,
            'anthropic-version': '2023-06-01',
          },
        },
        { timeoutMs: TIMEOUT_MS }
      );
      const data = Array.isArray(json.data) ? json.data : [];
      for (const m of data) {
        results.push({
          id: m.id,
          provider: p.id,
          name: m.display_name || m.id,
          createdAt: m.created_at,
          raw: m,
        });
      }
      if (!json.has_more) break;
      afterId = json.last_id;
      if (!afterId) break;
    }
    return results;
  }

  private async listGemini(p: ProviderConfig): Promise<AvailableModel[]> {
    if (!p.apiKey) throw new Error('API key missing');
    const results: AvailableModel[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < 20; page++) {
      const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
      url.searchParams.set('pageSize', '100');
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const json = await fetchJson<{ models?: any[]; nextPageToken?: string }>(
        url.toString(),
        { headers: { 'x-goog-api-key': p.apiKey } }, // ⭐ key in header, not URL
        { timeoutMs: TIMEOUT_MS }
      );
      const models = Array.isArray(json.models) ? json.models : [];
      for (const m of models) {
        if (!m.supportedGenerationMethods?.includes('generateContent')) continue;
        results.push({
          id: m.name.replace(/^models\//, ''),
          provider: p.id,
          name: m.displayName || m.name,
          contextWindow: m.inputTokenLimit,
          raw: m,
        });
      }
      pageToken = json.nextPageToken;
      if (!pageToken) break;
    }
    return results;
  }

  private async listOllama(p: ProviderConfig): Promise<AvailableModel[]> {
    const baseUrl = (p.baseUrl || 'http://localhost:11434').replace(/\/v1\/?$/, '');
    const json = await fetchJson<{ models?: any[] }>(
      `${baseUrl}/api/tags`,
      {},
      { timeoutMs: TIMEOUT_MS, blockPrivate: false } // local use allowed
    );
    const models = Array.isArray(json.models) ? json.models : [];
    return models.map((m) => ({
      id: m.name,
      provider: p.id,
      name: m.name,
      createdAt: m.modified_at,
      raw: m,
    }));
  }

  private isChatModel(id: unknown): boolean {
    if (typeof id !== 'string') return false;
    const lower = id.toLowerCase();
    const exclude = [
      'embedding', 'embed', 'whisper', 'tts', 'dall-e', 'moderation',
      'audio', 'davinci', 'babbage', 'realtime', 'transcribe',
    ];
    return !exclude.some((x) => lower.includes(x));
  }

  pickDefault(provider: ProviderConfig, models: AvailableModel[]): string | null {
    if (models.length === 0) return null;
    const find = (...names: string[]) => {
      for (const n of names) {
        const m = models.find((x) => x.id === n || x.id.startsWith(n));
        if (m) return m.id;
      }
      return null;
    };
    switch (provider.type) {
      case 'openai':
        return find('gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo') ?? models[0].id;
      case 'deepseek':
        return find('deepseek-chat', 'deepseek-reasoner') ?? models[0].id;
      case 'claude':
        return find('claude-sonnet-4', 'claude-3-5-sonnet', 'claude-3-opus', 'claude-3-sonnet') ?? models[0].id;
      case 'gemini':
        return find('gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-pro') ?? models[0].id;
      default:
        return models[0].id;
    }
  }
}
