"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaProvider = void 0;
const AIProvider_1 = require("./AIProvider");
const fetch = require('node-fetch');
class OllamaProvider extends AIProvider_1.AIProvider {
    constructor(config = {}) {
        super();
        this.name = 'ollama';
        this.displayName = 'Ollama (Local)';
        this.description = 'Run LLMs locally — no API key required';
        this.icon = '🦙';
        this.baseUrl = config.baseUrl ?? 'http://localhost:11434';
        this.model = config.model ?? 'llama3.2';
        this.keepAlive = config.keepAlive ?? '5m';
        this.numCtx = config.numCtx ?? 4096;
    }
    async complete(req) {
        // Build message array in OpenAI-compatible format
        // (Ollama supports this via /api/chat)
        const messages = [
            { role: 'system', content: req.systemPrompt },
            ...(req.history ?? []),
            { role: 'user', content: req.userMessage },
        ];
        const body = {
            model: this.model,
            messages,
            stream: false,
            keep_alive: this.keepAlive,
            options: {
                num_ctx: this.numCtx,
                temperature: req.temperature ?? 0.7,
                num_predict: req.maxTokens ?? 2000,
            },
        };
        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Ollama error ${response.status}: ${err}\n` +
                `Is Ollama running? Start it with: ollama serve`);
        }
        const data = await response.json();
        return {
            content: data.message?.content ?? '',
            tokensUsed: data.eval_count,
            model: data.model ?? this.model,
        };
    }
    // ── Ollama-specific helpers ───────────────────
    /** List all locally available models */
    async listModels() {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);
            if (!response.ok) {
                return [];
            }
            const data = await response.json();
            return (data.models ?? []).map((m) => m.name);
        }
        catch {
            return [];
        }
    }
    /** Check whether Ollama is reachable */
    async isAvailable() {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`, {
                signal: AbortSignal.timeout(3000),
            });
            return response.ok;
        }
        catch {
            return false;
        }
    }
    /** Pull a model if not already downloaded */
    async pullModel(modelName) {
        await fetch(`${this.baseUrl}/api/pull`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: modelName, stream: false }),
        });
    }
}
exports.OllamaProvider = OllamaProvider;
//# sourceMappingURL=OllamaProvider.js.map