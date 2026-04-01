import { AIProvider } from '../providers/AIProvider';
import { AgentMemory } from './AgentMemory';

// ─────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────

export interface ReasoningStep {
    thought: string;   // Internal reasoning
    action: string;   // What the agent does
    observation: string;  // What it observes
}

export interface ReasoningResult {
    steps: ReasoningStep[];
    finalAnswer: string;
    confidence: number;        // 0–1
    tokensUsed: number;
}

// ─────────────────────────────────────────────
//  ReasoningEngine — ReAct-style chain-of-thought
// ─────────────────────────────────────────────

export class ReasoningEngine {
    constructor(
        private readonly provider: AIProvider,
        private readonly memory: AgentMemory
    ) { }

    /**
     * Execute a multi-step reasoning chain (ReAct pattern).
     * The agent thinks → acts → observes, iterating up to maxSteps.
     */
    async reason(
        task: string,
        context: string,
        maxSteps = 3
    ): Promise<ReasoningResult> {
        const steps: ReasoningStep[] = [];
        let tokensUsed = 0;

        // Retrieve relevant memories to seed context
        const memories = this.memory.getRelevantMemories(task, 3);
        const memContext = memories.length
            ? `\nRelevant past context:\n${memories.map(m => m.content).join('\n---\n')}`
            : '';

        const systemPrompt = `You are an advanced AI coding agent with chain-of-thought reasoning.
Use this format for each step:
THOUGHT: <your internal reasoning>
ACTION: <what you will do>
OBSERVATION: <what you observe or conclude>

After all steps end with:
FINAL_ANSWER: <your complete response>
CONFIDENCE: <0.0-1.0>
${memContext}`;

        let conversation = `Task: ${task}\n\nContext:\n${context}\n\nBegin reasoning:`;
        const history = this.memory.getFormattedHistory(6);

        for (let step = 0; step < maxSteps; step++) {
            const response = await this.provider.complete({
                systemPrompt,
                userMessage: conversation,
                history,
                temperature: 0.3,        // lower = more deterministic reasoning
                maxTokens: 1_500,
            });

            tokensUsed += response.tokensUsed ?? 0;

            const parsed = this.parseReasoningStep(response.content);
            steps.push(parsed);

            // Stop early once a final answer is produced
            if (response.content.includes('FINAL_ANSWER:')) { break; }

            // Feed observation back in for next iteration
            conversation += `\n${response.content}\nContinue:`;
        }

        return {
            steps,
            finalAnswer: this.extractFinalAnswer(steps),
            confidence: this.extractConfidence(steps),
            tokensUsed,
        };
    }

    // ── Parsing helpers ───────────────────────────

    private parseReasoningStep(raw: string): ReasoningStep {
        return {
            thought: this.extract(raw, 'THOUGHT') ?? 'Analyzing...',
            action: this.extract(raw, 'ACTION') ?? 'Processing...',
            observation: this.extract(raw, 'OBSERVATION') ??
                this.extract(raw, 'FINAL_ANSWER') ?? raw,
        };
    }

    private extract(text: string, label: string): string | undefined {
        const match = text.match(new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`));
        return match?.[1]?.trim();
    }

    private extractFinalAnswer(steps: ReasoningStep[]): string {
        // Walk backwards to find the last FINAL_ANSWER
        for (let i = steps.length - 1; i >= 0; i--) {
            if (steps[i].observation && steps[i].observation.length > 20) {
                return steps[i].observation;
            }
        }
        return steps.at(-1)?.observation ?? 'Unable to complete reasoning.';
    }

    private extractConfidence(steps: ReasoningStep[]): number {
        const last = steps.at(-1)?.observation ?? '';
        const match = last.match(/CONFIDENCE:\s*([\d.]+)/);
        return match ? Math.min(1, Math.max(0, parseFloat(match[1]))) : 0.7;
    }
}