import { ProviderConfig } from './registry.js';

export interface AvailableModel {
  id: string;
  provider: string;
  name: string;
  contextWindow?: number;
  createdAt?: string;
  raw?: any;
}

/**
 * Har provider ke /models endpoint se full list fetch karta hai.
 * Non-chat models filter kar deta hai (embeddings, whisper, tts, dall-e).
 */
export class ModelDiscovery {
  async list(provider: ProviderConfig): Promise<AvailableModel[]> {
    switch (provider.type) {
      case 'openai':
        return this.listOpenAI(provider);
      case 'claude':
        return this.listAnthropic(provider);
      case 'gemini':
        return this.listGemini(provider);
      case 'ollama':
        return this.listOllama(provider);
      case 'custom':
        return this.listOpenAICompatible(provider);
      default:
        return [];
    }
  }

  private async listOpenAI(p: ProviderConfig): Promise<AvailableModel[]> {
    let baseUrl = p.baseUrl || 'https://api.openai.com/v1';
    baseUrl = baseUrl.replace(/\/+$/, '');
    if (!baseUrl.endsWith('/v1') && !baseUrl.includes('/v1')) {
      baseUrl += '/v1';
    }
    const res = await fetch(`${baseUrl}/models`, {
      headers: {
        ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}),
      },
    });
    if (!res.ok) {
      throw new Error(`OpenAI models fetch failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { data?: any[] };
    const data = json.data || [];
    return data
      .filter((m) => this.isChatModel(m.id))
      .map((m) => ({
        id: m.id,
        provider: p.id,
        name: m.id,
        createdAt: m.created ? new Date(m.created * 1000).toISOString() : undefined,
        raw: m,
      }));
  }

  private async listAnthropic(p: ProviderConfig): Promise<AvailableModel[]> {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': p.apiKey || '',
        'anthropic-version': '2023-06-01',
      },
    });
    if (!res.ok) {
      throw new Error(`Anthropic models fetch failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { data?: any[] };
    const data = json.data || [];
    return data.map((m) => ({
      id: m.id,
      provider: p.id,
      name: m.display_name || m.id,
      createdAt: m.created_at,
      raw: m,
    }));
  }

  private async listGemini(p: ProviderConfig): Promise<AvailableModel[]> {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${p.apiKey || ''}`
    );
    if (!res.ok) {
      throw new Error(`Gemini models fetch failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { models?: any[] };
    const models = json.models || [];
    return models
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => ({
        id: m.name.replace(/^models\//, ''),
        provider: p.id,
        name: m.displayName || m.name,
        contextWindow: m.inputTokenLimit,
        raw: m,
      }));
  }

  private async listOllama(p: ProviderConfig): Promise<AvailableModel[]> {
    const baseUrl = (p.baseUrl || 'http://localhost:11434').replace(/\/v1\/?$/, '');
    const res = await fetch(`${baseUrl}/api/tags`);
    if (!res.ok) {
      throw new Error(`Ollama models fetch failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { models?: any[] };
    const models = json.models || [];
    return models.map((m) => ({
      id: m.name,
      provider: p.id,
      name: m.name,
      createdAt: m.modified_at,
      raw: m,
    }));
  }

  private async listOpenAICompatible(p: ProviderConfig): Promise<AvailableModel[]> {
    let baseUrl = (p.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
    if (!baseUrl.endsWith('/v1') && !baseUrl.includes('/v1')) {
      baseUrl += '/v1';
    }
    const headers: Record<string, string> = {};
    if (p.apiKey) {
      headers['Authorization'] = `Bearer ${p.apiKey}`;
    }
    const res = await fetch(`${baseUrl}/models`, { headers });
    if (!res.ok) {
      throw new Error(`Custom provider models fetch failed: ${res.status}`);
    }
    const json = (await res.json()) as { data?: any[] };
    const data = json.data || [];
    return data.map((m) => ({
      id: m.id,
      provider: p.id,
      name: m.id,
      raw: m,
    }));
  }

  private isChatModel(id: string): boolean {
    const lower = id.toLowerCase();
    const exclude = [
      'embedding',
      'whisper',
      'tts',
      'dall-e',
      'moderation',
      'audio',
      'davinci',
      'babbage',
      'realtime',
    ];
    return !exclude.some((x) => lower.includes(x));
  }

  /** Default model picker — best sensible default per provider type. */
  pickDefault(provider: ProviderConfig, models: AvailableModel[]): string | null {
    if (!models || models.length === 0) return null;

    switch (provider.type) {
      case 'openai': {
        const preferred = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'];
        for (const p of preferred) {
          const found = models.find((m) => m.id === p);
          if (found) return found.id;
        }
        return models[0].id;
      }
      case 'claude': {
        const preferred = [
          'claude-3-5-sonnet-20241022',
          'claude-3-5-sonnet-latest',
          'claude-3-opus-latest',
          'claude-3-haiku-20240307'
        ];
        for (const p of preferred) {
          const found = models.find((m) => m.id === p);
          if (found) return found.id;
        }
        return models[0].id;
      }
      case 'gemini': {
        const preferred = [
          'gemini-2.0-flash',
          'gemini-1.5-pro',
          'gemini-1.5-flash',
          'gemini-pro',
        ];
        for (const p of preferred) {
          const found = models.find((m) => m.id === p);
          if (found) return found.id;
        }
        return models[0].id;
      }
      case 'ollama':
      case 'custom':
      default:
        return models[0].id;
    }
  }
}
