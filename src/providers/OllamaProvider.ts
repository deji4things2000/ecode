import { AIProvider, CompletionRequest, CompletionResponse } from './AIProvider';

const fetch = require('node-fetch');

// ─────────────────────────────────────────────
//  OllamaProvider
//  Connects to a locally running Ollama instance.
//  Default base URL: http://localhost:11434
//  Project: https://github.com/ollama/ollama
// ─────────────────────────────────────────────

export interface OllamaConfig {
  baseUrl?:    string;   // default http://localhost:11434
  model?:      string;   // default llama3.2
  keepAlive?:  string;   // how long to keep model in memory e.g. "5m"
  numCtx?:     number;   // context window size
}

export class OllamaProvider extends AIProvider {
  readonly name        = 'ollama';
  readonly displayName = 'Ollama (Local)';
  readonly description = 'Run LLMs locally — no API key required';
  readonly icon        = '🦙';

  private readonly baseUrl:   string;
  private readonly model:     string;
  private readonly keepAlive: string;
  private readonly numCtx:    number;

  constructor(config: OllamaConfig = {}) {
    super();
    this.baseUrl   = config.baseUrl   ?? 'http://localhost:11434';
    this.model     = config.model     ?? 'llama3.2';
    this.keepAlive = config.keepAlive ?? '5m';
    this.numCtx    = config.numCtx    ?? 4096;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    // Build message array in OpenAI-compatible format
    // (Ollama supports this via /api/chat)
    const messages = [
      { role: 'system', content: req.systemPrompt },
      ...(req.history ?? []),
      { role: 'user',   content: req.userMessage },
    ];

    const body = {
      model:      this.model,
      messages,
      stream:     false,
      keep_alive: this.keepAlive,
      options: {
        num_ctx:     this.numCtx,
        temperature: req.temperature ?? 0.7,
        num_predict: req.maxTokens   ?? 2_000,
      },
    };

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(
        `Ollama error ${response.status}: ${err}\n` +
        `Is Ollama running? Start it with: ollama serve`
      );
    }

    const data = await response.json();

    return {
      content:    data.message?.content ?? '',
      tokensUsed: data.eval_count,
      model:      data.model ?? this.model,
    };
  }

  // ── Ollama-specific helpers ───────────────────

  /** List all locally available models */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) { return []; }
      const data = await response.json();
      return (data.models ?? []).map((m: { name: string }) => m.name);
    } catch {
      return [];
    }
  }

  /** Check whether Ollama is reachable */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Pull a model if not already downloaded */
  async pullModel(modelName: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/pull`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: modelName, stream: false }),
    });
  }
}