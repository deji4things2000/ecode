"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIProvider = void 0;
const AIProvider_1 = require("./AIProvider");
const fetch = require('node-fetch');
class OpenAIProvider extends AIProvider_1.AIProvider {
    constructor(apiKey, model = 'gpt-4o') {
        super();
        this.apiKey = apiKey;
        this.model = model;
        this.name = 'openai';
        this.baseUrl = 'https://api.openai.com/v1';
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
            max_tokens: req.maxTokens ?? 2000,
        };
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const err = await response.text();
            throw new Error(`OpenAI API error ${response.status}: ${err}`);
        }
        const data = await response.json();
        return {
            content: data.choices[0].message.content,
            tokensUsed: data.usage?.total_tokens,
            model: data.model,
        };
    }
}
exports.OpenAIProvider = OpenAIProvider;
//# sourceMappingURL=OpenAIProvider.js.map