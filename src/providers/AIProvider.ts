// ─────────────────────────────────────────────
//  Shared types and abstract base
// ─────────────────────────────────────────────

export interface CompletionRequest {
    systemPrompt: string;
    userMessage: string;
    history?: Array<{ role: string; content: string }>;
    temperature?: number;
    maxTokens?: number;
}

export interface CompletionResponse {
    content: string;
    tokensUsed?: number;
    model: string;
}

export abstract class AIProvider {
    abstract readonly name: string;

    abstract complete(req: CompletionRequest): Promise<CompletionResponse>;

    /** Quick helper — wraps complete() with a single-shot prompt */
    async ask(prompt: string, system?: string): Promise<string> {
        const res = await this.complete({
            systemPrompt: system ?? 'You are a helpful AI coding assistant.',
            userMessage: prompt,
        });
        return res.content;
    }
}