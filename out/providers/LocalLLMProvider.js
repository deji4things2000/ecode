"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalLLMProvider = void 0;
const AIProvider_1 = require("./AIProvider");
const fetch = require('node-fetch');
const BACKEND_DEFAULTS = {
    lmstudio: { url: 'http://localhost:1234', path: '/v1/chat/completions' },
    llamacpp: { url: 'http://localhost:8080', path: '/v1/chat/completions' },
    jan: { url: 'http://localhost:1337', path: '/v1/chat/completions' },
    textgen: { url: 'http://localhost:5000', path: '/v1/chat/completions' },
    custom: { url: 'http://localhost:1234', path: '/v1/chat/completions' },
};
class LocalLLMProvider extends AIProvider_1.AIProvider {
    constructor(config = {}) {
        super();
        this.name = 'localllm';
        this.displayName = 'Local LLM Copilot';
        this.description = 'Fast completions via LM Studio, llama.cpp, Jan, or any OpenAI-compatible server';
        this.icon = '💻';
        const backend = config.backend ?? 'lmstudio';
        const defaults = BACKEND_DEFAULTS[backend];
        this.endpoint = `${config.baseUrl ?? defaults.url}${defaults.path}`;
        this.model = config.model ?? 'local-model';
        this.apiKey = config.apiKey ?? 'local';
        this.ctxSize = config.contextSize ?? 4096;
    }
    async complete(req) {
        const messages = [
            { role: 'system', content: req.systemPrompt },
            ...(req.history ?? []),
            { role: 'user', content: req.userMessage },
        ];
        const body = {
            model: this.model,
            messages,
            temperature: req.temperature ?? 0.7,
            max_tokens: Math.min(req.maxTokens ?? 2000, this.ctxSize),
            stream: false,
        };
        const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const err = await response.text();
            throw new Error(`LocalLLM error ${response.status}: ${err}\n` +
                `Endpoint: ${this.endpoint} — is the server running?`);
        }
        const data = await response.json();
        return {
            content: data.choices?.[0]?.message?.content ?? '',
            tokensUsed: data.usage?.total_tokens,
            model: data.model ?? this.model,
        };
    }
    // ── Completion-only mode (faster for inline suggestions) ──
    async completeText(prompt, maxTokens = 256) {
        // Use /completions endpoint for raw text completion
        const completionUrl = this.endpoint.replace('chat/completions', 'completions');
        const response = await fetch(completionUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                prompt,
                max_tokens: maxTokens,
                temperature: 0.2,
                stream: false,
            }),
        });
        if (!response.ok) {
            return '';
        }
        const data = await response.json();
        return data.choices?.[0]?.text ?? '';
    }
    async isAvailable() {
        try {
            const healthUrl = this.endpoint
                .replace('/chat/completions', '/models')
                .replace('/completions', '/models');
            const response = await fetch(healthUrl, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` },
                signal: AbortSignal.timeout(3000),
            });
            return response.ok;
        }
        catch {
            return false;
        }
    }
}
exports.LocalLLMProvider = LocalLLMProvider;
//# sourceMappingURL=LocalLLMProvider.js.map