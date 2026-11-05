import { ProviderRegistry, ProviderConfig } from './registry.js';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface CompleteResult {
  provider: string;
  providerType: string;
  model: string;
  text: string;
}

export class ProviderController {
  constructor(
    private registry: ProviderRegistry,
    private strategy: 'fallback' | 'round-robin' = 'fallback'
  ) {}

  async complete(
    prompt: string,
    system?: string,
    preferredId?: string
  ): Promise<CompleteResult> {
    let candidates = this.registry.getActive();

    if (preferredId) {
      const preferred = candidates.find((p) => p.id === preferredId);
      if (preferred) {
        candidates = [preferred, ...candidates.filter((p) => p.id !== preferredId)];
      }
    }

    if (candidates.length === 0) {
      throw new Error(
        'No active providers. Run `qa add` and `qa connect` first.'
      );
    }

    const errors: string[] = [];
    let lastQuotaError: Error | null = null;

    for (const provider of candidates) {
      try {
        const text = await this.callProvider(provider, prompt, system);
        return {
          provider: provider.id,
          providerType: provider.type,
          model: provider.model,
          text,
        };
      } catch (err: any) {
        errors.push(`${provider.id}: ${err.message}`);
        if (this.isQuotaError(err)) {
          lastQuotaError = this.wrapQuotaError(provider.id, err);
          // Continue to next candidate provider for failover!
          continue;
        }
      }
    }

    // If quota error occurred and no other candidate succeeded, propagate quota error for auto-pause
    if (lastQuotaError) {
      throw lastQuotaError;
    }

    throw new Error(`All providers failed:\n${errors.join('\n')}`);
  }

  private async callProvider(
    p: ProviderConfig,
    prompt: string,
    system?: string
  ): Promise<string> {
    switch (p.type) {
      case 'openai':
        return this.callOpenAI(p, prompt, system);
      case 'claude':
        return this.callClaude(p, prompt, system);
      case 'gemini':
        return this.callGemini(p, prompt, system);
      case 'ollama':
        return this.callOllama(p, prompt, system);
      case 'custom':
        return this.callOpenAI(p, prompt, system);
      default:
        throw new Error(`Unknown provider type: ${p.type}`);
    }
  }

  private async callOpenAI(p: ProviderConfig, prompt: string, system?: string) {
    const client = new OpenAI({
      apiKey: p.apiKey || 'not-needed',
      baseURL: p.baseUrl || undefined,
    });
    const r = await client.chat.completions.create({
      model: p.model,
      messages: [
        ...(system ? [{ role: 'system' as const, content: system }] : []),
        { role: 'user' as const, content: prompt },
      ],
    });
    return r.choices[0]?.message?.content || '';
  }

  private async callClaude(p: ProviderConfig, prompt: string, system?: string) {
    const client = new Anthropic({ apiKey: p.apiKey || '' });
    const r = await client.messages.create({
      model: p.model,
      max_tokens: 4096,
      system: system || 'You are a precise reasoning assistant.',
      messages: [{ role: 'user', content: prompt }],
    });
    const block = r.content[0];
    return block?.type === 'text' ? block.text : '';
  }

  private async callGemini(p: ProviderConfig, prompt: string, system?: string) {
    const genAI = new GoogleGenerativeAI(p.apiKey || '');
    const model = genAI.getGenerativeModel({
      model: p.model,
      ...(system ? { systemInstruction: system } : {}),
    });
    const r = await model.generateContent(prompt);
    return r.response.text();
  }

  private async callOllama(p: ProviderConfig, prompt: string, system?: string) {
    const baseUrl = (p.baseUrl || 'http://localhost:11434').replace(/\/v1\/?$/, '');
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: p.model,
        prompt: system ? `${system}\n\n${prompt}` : prompt,
        stream: false,
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { response: string };
    return j.response;
  }

  private isQuotaError(err: any): boolean {
    const status = err?.status || err?.response?.status;
    const msg = (err?.message || '').toLowerCase();
    return (
      status === 429 ||
      status === 402 ||
      msg.includes('rate limit') ||
      msg.includes('quota') ||
      msg.includes('insufficient') ||
      msg.includes('resource_exhausted') ||
      msg.includes('429')
    );
  }

  private wrapQuotaError(providerId: string, err: any): Error {
    const retryAfter =
      parseInt(
        err?.response?.headers?.['retry-after'] ||
          err?.headers?.['retry-after'] ||
          '60',
        10
      ) || 60;
    const e = new Error(`QUOTA_EXHAUSTED:${providerId}:${retryAfter}`);
    (e as any).isQuota = true;
    (e as any).providerId = providerId;
    (e as any).retryAfter = retryAfter;
    return e;
  }
}
