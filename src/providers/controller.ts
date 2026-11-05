import { ProviderConfig } from './registry.js';
import { QuotaTracker } from '../brain/quota-tracker.js';
import { extractRetryAfterMs } from '../utils/retry.js';
import { safeFetch } from '../utils/net.js';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

export type ErrorClass =
  | 'AUTH_ERROR'
  | 'PERMISSION_ERROR'
  | 'QUOTA_EXHAUSTED'
  | 'RATE_LIMITED'
  | 'OFFLINE'
  | 'SERVER_ERROR'
  | 'UNKNOWN';

export class ProviderError extends Error {
  constructor(
    message: string,
    public providerId: string,
    public errorClass: ErrorClass,
    public retryAfterMs?: number
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface CompleteResult {
  provider: string;
  providerType: string;
  model: string;
  text: string;
}

export interface CompleteOptions {
  /** Providers to skip entirely. Fixes Bug 4. */
  excludeProviderIds?: Set<string>;
  /** Preferred provider first, then fallback. Fixes Bug 4. */
  preferredId?: string;
  /** Per-request timeout in ms. Fixes Bug 6. */
  timeoutMs?: number;
  /** Optional abort signal (task deadline). */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export class ProviderController {
  constructor(
    private registry: { getActive(): ProviderConfig[] },
    private quota: QuotaTracker
  ) {}

  async complete(
    prompt: string,
    system: string | undefined,
    opts: CompleteOptions = {}
  ): Promise<CompleteResult> {
    const exclude = opts.excludeProviderIds ?? new Set<string>();

    let candidates = this.registry
      .getActive()
      .filter((p) => !exclude.has(p.id) && this.quota.isAvailable(p.id));

    if (candidates.length === 0) {
      throw new ProviderError(
        'No eligible providers',
        'system',
        'QUOTA_EXHAUSTED'
      );
    }

    if (opts.preferredId) {
      const pref = candidates.find((p) => p.id === opts.preferredId);
      if (pref) candidates = [pref, ...candidates.filter((p) => p.id !== pref.id)];
    }

    const errors: ProviderError[] = [];

    for (const provider of candidates) {
      try {
        const text = await this.callProvider(
          provider,
          prompt,
          system,
          opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          opts.signal
        );
        this.quota.markOK(provider.id);
        return {
          provider: provider.id,
          providerType: provider.type,
          model: provider.model,
          text,
        };
      } catch (err: any) {
        const pe = this.classifyError(provider, err);
        errors.push(pe);

        if (pe.errorClass === 'QUOTA_EXHAUSTED' || pe.errorClass === 'RATE_LIMITED') {
          const cooldownMs = pe.retryAfterMs ?? 60_000;
          this.quota.markExhausted(provider.id, cooldownMs, pe.message);
        } else if (pe.errorClass === 'AUTH_ERROR' || pe.errorClass === 'PERMISSION_ERROR') {
          // Permanent — caller will exclude on subsequent rounds
          console.error(`[controller] ${provider.id} ${pe.errorClass}: ${pe.message}`);
        }
      }
    }

    // Preserve all errors — Bug 17
    const final = new ProviderError(
      `All providers failed: ${errors.map((e) => `${e.providerId}(${e.errorClass})`).join(', ')}`,
      'system',
      errors[0]?.errorClass ?? 'UNKNOWN'
    );
    (final as any).errors = errors;
    throw final;
  }

  private classifyError(p: ProviderConfig, err: any): ProviderError {
    const status =
      err?.status ??
      err?.statusCode ??
      err?.response?.status ??
      err?.code ??
      err?.cause?.status ??
      err?.cause?.code;
    const msg = String(err?.message || err || '');
    const retryAfterMs = extractRetryAfterMs(err) ?? extractRetryAfterMs(err?.cause);

    if (status === 401) return new ProviderError(msg, p.id, 'AUTH_ERROR');
    if (status === 402) return new ProviderError(msg, p.id, 'QUOTA_EXHAUSTED', retryAfterMs ?? 60_000);
    if (status === 403) return new ProviderError(msg, p.id, 'PERMISSION_ERROR');
    if (status === 429) return new ProviderError(msg, p.id, 'RATE_LIMITED', retryAfterMs ?? 60_000);
    if (typeof status === 'number' && status >= 500 && status < 600)
      return new ProviderError(msg, p.id, 'SERVER_ERROR', retryAfterMs ?? 30_000);

    const lower = msg.toLowerCase();
    if (lower.includes('abort') || lower.includes('timeout') || lower.includes('econn'))
      return new ProviderError(msg, p.id, 'OFFLINE', 30_000);
    if (lower.includes('rate limit') || lower.includes('quota'))
      return new ProviderError(msg, p.id, 'RATE_LIMITED', retryAfterMs ?? 60_000);

    return new ProviderError(msg, p.id, 'UNKNOWN');
  }

  private async callProvider(
    p: ProviderConfig,
    prompt: string,
    system: string | undefined,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<string> {
    const combinedSignal = signal
      ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal])
      : AbortSignal.timeout(timeoutMs);

    switch (p.type) {
      case 'openai':
        return this.callOpenAI(p, 'https://api.openai.com/v1', prompt, system, combinedSignal);
      case 'deepseek':
        return this.callOpenAI(p, 'https://api.deepseek.com', prompt, system, combinedSignal);
      case 'custom':
        if (!p.baseUrl) throw new Error('custom provider requires baseUrl');
        return this.callOpenAI(p, p.baseUrl, prompt, system, combinedSignal);
      case 'claude':
        return this.callClaude(p, prompt, system, combinedSignal);
      case 'gemini':
        return this.callGemini(p, prompt, system, combinedSignal);
      case 'ollama':
        return this.callOllama(p, prompt, system, combinedSignal);
      default:
        throw new Error(`Unknown provider type: ${(p as any).type}`);
    }
  }

  private async callOpenAI(
    p: ProviderConfig,
    fallbackBase: string,
    prompt: string,
    system: string | undefined,
    signal: AbortSignal
  ): Promise<string> {
    if (!p.apiKey) throw new Error('API key missing');
    const client = new OpenAI({
      apiKey: p.apiKey,
      baseURL: p.baseUrl || fallbackBase,
      fetch: globalThis.fetch as any,
      maxRetries: 0,
    });
    const r = await client.chat.completions.create(
      {
        model: p.model,
        messages: [
          ...(system ? [{ role: 'system' as const, content: system }] : []),
          { role: 'user' as const, content: prompt },
        ],
      },
      { signal }
    );
    return r.choices[0]?.message?.content || '';
  }

  private async callClaude(
    p: ProviderConfig,
    prompt: string,
    system: string | undefined,
    signal: AbortSignal
  ): Promise<string> {
    if (!p.apiKey) throw new Error('API key missing');
    const client = new Anthropic({
      apiKey: p.apiKey,
      fetch: globalThis.fetch as any,
      maxRetries: 0,
    });
    const r = await client.messages.create(
      {
        model: p.model,
        max_tokens: 4096,
        system: system || 'You are a precise reasoning assistant.',
        messages: [{ role: 'user', content: prompt }],
      },
      { signal }
    );
    const b = r.content[0];
    return b?.type === 'text' ? b.text : '';
  }

  private async callGemini(
    p: ProviderConfig,
    prompt: string,
    system: string | undefined,
    signal: AbortSignal
  ): Promise<string> {
    if (!p.apiKey) throw new Error('API key missing');
    // ⭐ raw fetch so AbortSignal applies (SDK lacks signal support)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(p.model)}:generateContent`;
    const body: any = {
      contents: [{ parts: [{ text: prompt }] }],
    };
    if (system) {
      body.systemInstruction = { parts: [{ text: system }] };
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'x-goog-api-key': p.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const err: any = new Error(`Gemini ${res.status}: ${await res.text().catch(() => '')}`);
      err.status = res.status;
      err.headers = Object.fromEntries(res.headers.entries());
      throw err;
    }
    const json: any = await res.json();
    return json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }

  private async callOllama(
    p: ProviderConfig,
    prompt: string,
    system: string | undefined,
    signal: AbortSignal
  ): Promise<string> {
    const baseUrl = (p.baseUrl || 'http://localhost:11434').replace(/\/v1\/?$/, '');
    const res = await safeFetch(
      `${baseUrl}/api/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: p.model,
          prompt: system ? `${system}\n\n${prompt}` : prompt,
          stream: false,
        }),
      },
      { signal, blockPrivate: false }
    );
    if (!res.ok) {
      const err: any = new Error(`Ollama ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const j = (await res.json()) as { response?: string };
    return j.response ?? '';
  }
}
