import { AIProvider, CompletionRequest, CompletionResponse } from './AIProvider';

const fetch = require('node-fetch');

// ─────────────────────────────────────────────
//  LocalLLMProvider
//  Connects to any OpenAI-compatible local server:
//    - LM Studio  (http://localhost:1234)
//    - llama.cpp  (http://localhost:8080)
//    - Jan        (http://localhost:1337)
//    - text-gen-webui (http://localhost:5000)
//  Project: https://github.com/ggerganov/llama.cpp
// ─────────────────────────────────────────────

export type LocalLLMBackend =
  | 'lmstudio'
  | 'llamacpp'
  | 'jan'
  | 'textgen'
  | 'custom';

const BACKEND_DEFAULTS: Record<LocalLLMBackend, { url: string; path: string }> = {
  lmstudio: { url: 'http://localhost:1234', path: '/v1/chat/completions' },
  llamacpp:  { url: 'http://localhost:8080', path: '/v1/chat/completions' },
  jan:       { url: 'http://localhost:1337', path: '/v1/chat/completions' },
  textgen:   { url: 'http://localhost:5000', path: '/v1/chat/completions' },
  custom:    { url: 'http://localhost:1234', path: '/v1/chat/completions' },
};

export interface LocalLLMConfig {
  backend?:    LocalLLMBackend;
  baseUrl?:    string;         // override default URL
  model?:      string;         // model name/path
  apiKey?:     string;         // some servers require a key (default 'local')
  contextSize?: number;        // context window (default 4096)
}

export class LocalLLMProvider extends AIProvider {
  readonly name        = 'localllm';
  readonly displayName = 'Local LLM Copilot';
  readonly description = 'Fast completions via LM Studio, llama.cpp, Jan, or any OpenAI-compatible server';
  readonly icon        = '💻';

  private readonly endpoint: string;
  private readonly model:    string;
  private readonly apiKey:   string;
  private readonly ctxSize:  number;

  constructor(config: LocalLLMConfig = {}) {
    super();

    const backend  = config.backend ?? 'lmstudio';
    const defaults = BACKEND_DEFAULTS[backend];

    this.endpoint = `${config.baseUrl ?? defaults.url}${defaults.path}`;
    this.model    = config.model   ?? 'local-model';
    this.apiKey   = config.apiKey  ?? 'local';
    this.ctxSize  = config.contextSize ?? 4_096;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const messages = [
      { role: 'system', content: req.systemPrompt },
      ...(req.history ?? []),
      { role: 'user',   content: req.userMessage  },
    ];

    const body = {
      model:       this.model,
      messages,
      temperature: req.temperature ?? 0.7,
      max_tokens:  Math.min(req.maxTokens ?? 2_000, this.ctxSize),
      stream:      false,
    };

    const response = await fetch(this.endpoint, {
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
        `LocalLLM error ${response.status}: ${err}\n` +
        `Endpoint: ${this.endpoint} — is the server running?`
      );
    }

    const data = await response.json();

    return {
      content:    data.choices?.[0]?.message?.content ?? '',
      tokensUsed: data.usage?.total_tokens,
      model:      data.model ?? this.model,
    };
  }

  // ── Completion-only mode (faster for inline suggestions) ──

  async completeText(
    prompt:      string,
    maxTokens =  256
  ): Promise<string> {
    // Use /completions endpoint for raw text completion
    const completionUrl = this.endpoint.replace(
      'chat/completions',
      'completions'
    );

    const response = await fetch(completionUrl, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model:       this.model,
        prompt,
        max_tokens:  maxTokens,
        temperature: 0.2,
        stream:      false,
      }),
    });

    if (!response.ok) { return ''; }

    const data = await response.json();
    return data.choices?.[0]?.text ?? '';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const healthUrl = this.endpoint
        .replace('/chat/completions', '/models')
        .replace('/completions', '/models');

      const response = await fetch(healthUrl, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal:  AbortSignal.timeout(3_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}