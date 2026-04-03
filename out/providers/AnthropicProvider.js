"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnthropicProvider = void 0;
const AIProvider_1 = require("./AIProvider");
const fetch = require('node-fetch');
class AnthropicProvider extends AIProvider_1.AIProvider {
    constructor(apiKey, model = 'claude-3-5-sonnet-20241022') {
        super();
        this.apiKey = apiKey;
        this.model = model;
        this.name = 'anthropic';
        this.baseUrl = 'https://api.anthropic.com/v1';
    }
    async complete(req) {
        // Anthropic separates system from messages
        const messages = [
            ...(req.history?.map(h => ({
                role: h.role,
                content: h.content,
            })) ?? []),
            { role: 'user', content: req.userMessage },
        ];
        const body = {
            model: this.model,
            system: req.systemPrompt,
            messages,
            temperature: req.temperature ?? 0.7,
            max_tokens: req.maxTokens ?? 2000,
        };
        const response = await fetch(`${this.baseUrl}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Anthropic API error ${response.status}: ${err}`);
        }
        const data = await response.json();
        return {
            content: data.content[0].text,
            tokensUsed: data.usage?.input_tokens + data.usage?.output_tokens,
            model: data.model,
        };
    }
}
exports.AnthropicProvider = AnthropicProvider;
//# sourceMappingURL=AnthropicProvider.js.map