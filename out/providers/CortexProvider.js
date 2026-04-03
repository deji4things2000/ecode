"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CortexProvider = void 0;
const AIProvider_1 = require("./AIProvider");
const fetch = require('node-fetch');
class CortexProvider extends AIProvider_1.AIProvider {
    constructor(config = {}) {
        super();
        this.name = 'cortex';
        this.displayName = 'CortexIDE';
        this.description = 'Privacy-first local LLM — complete Cursor alternative';
        this.icon = '🧠';
        this.baseUrl = config.baseUrl ?? 'http://localhost:39281';
        this.model = config.model ?? 'cortexso/llama3.2';
        this.apiKey = config.apiKey ?? 'cortex';
    }
    async complete(req) {
        // Cortex uses the OpenAI-compatible /v1/chat/completions endpoint
        const messages = [
            { role: 'system', content: req.systemPrompt },
            ...(req.history ?? []),
            { role: 'user', content: req.userMessage },
        ];
        const body = {
            model: this.model,
            messages,
            temperature: req.temperature ?? 0.7,
            max_tokens: req.maxTokens ?? 2000,
            stream: false,
        };
        const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Cortex error ${response.status}: ${err}\n` +
                `Is CortexIDE running? Start it with: cortex start`);
        }
        const data = await response.json();
        return {
            content: data.choices[0]?.message?.content ?? '',
            tokensUsed: data.usage?.total_tokens,
            model: data.model ?? this.model,
        };
    }
    // ── Cortex-specific ───────────────────────────
    /** List models available in the local Cortex instance */
    async listModels() {
        try {
            const response = await fetch(`${this.baseUrl}/v1/models`, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` },
            });
            if (!response.ok) {
                return [];
            }
            const data = await response.json();
            return (data.data ?? []).map((m) => m.id);
        }
        catch {
            return [];
        }
    }
    async isAvailable() {
        try {
            const response = await fetch(`${this.baseUrl}/healthz`, {
                signal: AbortSignal.timeout(3000),
            });
            return response.ok;
        }
        catch {
            return false;
        }
    }
    /** Pull / download a model into Cortex */
    async pullModel(modelId) {
        await fetch(`${this.baseUrl}/v1/models/pull`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({ model: modelId }),
        });
    }
}
exports.CortexProvider = CortexProvider;
//# sourceMappingURL=CortexProvider.js.map