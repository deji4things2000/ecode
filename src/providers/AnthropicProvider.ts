import { AIProvider, CompletionRequest, CompletionResponse } from './AIProvider';

const fetch = require('node-fetch');

export class AnthropicProvider extends AIProvider {
    readonly name = 'anthropic';
    private readonly baseUrl = 'https://api.anthropic.com/v1';

    constructor(
        private readonly apiKey: string,
        private readonly model: string = 'claude-3-5-sonnet-20241022'
    ) {
        super();
    }

    async complete(req: CompletionRequest): Promise<CompletionResponse> {
        // Anthropic separates system from messages
        const messages = [
            ...(req.history?.map(h => ({
                role: h.role as 'user' | 'assistant',
                content: h.content,
            })) ?? []),
            { role: 'user' as const, content: req.userMessage },
        ];

        const body = {
            model: this.model,
            system: req.systemPrompt,
            messages,
            temperature: req.temperature ?? 0.7,
            max_tokens: req.maxTokens ?? 2_000,
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