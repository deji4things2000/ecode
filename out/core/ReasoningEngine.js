"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReasoningEngine = void 0;
// ─────────────────────────────────────────────
//  ReasoningEngine — ReAct-style chain-of-thought
// ─────────────────────────────────────────────
class ReasoningEngine {
    constructor(provider, memory) {
        this.provider = provider;
        this.memory = memory;
    }
    /**
     * Execute a multi-step reasoning chain (ReAct pattern).
     * The agent thinks → acts → observes, iterating up to maxSteps.
     */
    async reason(task, context, maxSteps = 3) {
        const steps = [];
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
                temperature: 0.3, // lower = more deterministic reasoning
                maxTokens: 1500,
            });
            tokensUsed += response.tokensUsed ?? 0;
            const parsed = this.parseReasoningStep(response.content);
            steps.push(parsed);
            // Stop early once a final answer is produced
            if (response.content.includes('FINAL_ANSWER:')) {
                break;
            }
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
    parseReasoningStep(raw) {
        return {
            thought: this.extract(raw, 'THOUGHT') ?? 'Analyzing...',
            action: this.extract(raw, 'ACTION') ?? 'Processing...',
            observation: this.extract(raw, 'OBSERVATION') ??
                this.extract(raw, 'FINAL_ANSWER') ?? raw,
        };
    }
    extract(text, label) {
        const match = text.match(new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`));
        return match?.[1]?.trim();
    }
    extractFinalAnswer(steps) {
        // Walk backwards to find the last FINAL_ANSWER
        for (let i = steps.length - 1; i >= 0; i--) {
            if (steps[i].observation && steps[i].observation.length > 20) {
                return steps[i].observation;
            }
        }
        return steps.at(-1)?.observation ?? 'Unable to complete reasoning.';
    }
    extractConfidence(steps) {
        const last = steps.at(-1)?.observation ?? '';
        const match = last.match(/CONFIDENCE:\s*([\d.]+)/);
        return match ? Math.min(1, Math.max(0, parseFloat(match[1]))) : 0.7;
    }
}
exports.ReasoningEngine = ReasoningEngine;
//# sourceMappingURL=ReasoningEngine.js.map