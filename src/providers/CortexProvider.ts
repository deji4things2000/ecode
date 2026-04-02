import { AIProvider, CompletionRequest, CompletionResponse } from './AIProvider';

const fetch = require('node-fetch');

// ─────────────────────────────────────────────
//  CortexProvider
//  Connects to CortexIDE's local LLM server or
//  any OpenAI-compatible local endpoint.
//  CortexIDE is a privacy-first Cursor alternative.
//  Project: https://github.com/janhq/cortex.cpp
// ─────────────────────────────────────────────

export interface CortexConfig {
  baseUrl?:    string;   // default http://localhost:39281
  model?:      string;   // default cortexso/llama3.2
  apiKey?:     string;   // optional, some deployments require it
}

export class CortexProvider extends AIProvider {
  readonly name        = 'cortex';
  readonly displayName = 'CortexIDE';
  readonly description = 'Privacy-first local LLM — complete Cursor alternative';
  readonly icon        = '🧠';

  private readonly baseUrl: string;
  private readonly model:   string;
  private readonly apiKey:  string;

  constructor(config: CortexConfig = {}) {
    super();
    this.baseUrl = config.baseUrl ?? 'http://localhost:39281';
    this.model   = config.model   ?? 'cortexso/llama3.2';
    this.apiKey  = config.apiKey  ?? 'cortex';
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    // Cortex uses the OpenAI-compatible /v1/chat/completions endpoint
    const messages = [
      { role: 'system', content: req.systemPrompt },
      ...(req.history ?? []),
      { role: 'user',   content: req.userMessage  },
    ];

    const body = {
      model:       this.model,
      messages,
      temperature: req.temperature ?? 0.7,
      max_tokens:  req.maxTokens   ?? 2_000,
      stream:      false,
    };

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(
        `Cortex error ${response.status}: ${err}\n` +
        `Is CortexIDE running? Start it with: cortex start`
      );
    }

    const data = await response.json();

    return {
      content:    data.choices[0]?.message?.content ?? '',
      tokensUsed: data.usage?.total_tokens,
      model:      data.model ?? this.model,
    };
  }

  // ── Cortex-specific ───────────────────────────

  /** List models available in the local Cortex instance */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      if (!response.ok) { return []; }
      const data = await response.json();
      return (data.data ?? []).map((m: { id: string }) => m.id);
    } catch {
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/healthz`, {
        signal: AbortSignal.timeout(3_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Pull / download a model into Cortex */
  async pullModel(modelId: string): Promise<void> {
    await fetch(`${this.baseUrl}/v1/models/pull`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: modelId }),
    });
  }
}