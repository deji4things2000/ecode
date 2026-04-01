import { AIProvider, CompletionRequest, CompletionResponse } from './AIProvider';

const fetch = require('node-fetch');

export class OpenAIProvider extends AIProvider {
    readonly name = 'openai';
    private readonly baseUrl = 'https://api.openai.com/v1';

    constructor(
        private readonly apiKey: string,
        private readonly model: string = 'gpt-4o'
    ) {
        super();
    }

    async complete(req: CompletionRequest): Promise<CompletionResponse> {
        const messages = [
            { role: 'system', content: req.systemPrompt },
            ...(req.history ?? []),
            { role: 'user', content: req.userMessage },
        ];

        const body = {
            model: this.model,
            messages,
            temperature: req.temperature ?? 0.7,
            max_tokens: req.maxTokens ?? 2_000,
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