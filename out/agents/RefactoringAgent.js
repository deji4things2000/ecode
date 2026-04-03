"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RefactoringAgent = void 0;
class RefactoringAgent {
    constructor(provider, memory, reasoning) {
        this.provider = provider;
        this.memory = memory;
        this.reasoning = reasoning;
    }
    async execute(task) {
        const code = task.context ?? task.input;
        const language = task.language ?? 'code';
        // Plan refactoring strategy before writing code
        const strategy = await this.reasoning.reason('Plan a comprehensive refactoring strategy', `Language: ${language}\n\nCode:\n${code}`, 2);
        // Apply strategy to produce refactored code
        const refactored = await this.provider.complete({
            systemPrompt: `You are a senior software engineer performing code refactoring.
Based on the strategy below, provide:
REFACTORED_CODE: The complete improved code
CHANGES_MADE: Bullet list of all changes
DESIGN_PATTERNS: Any patterns applied
METRICS_IMPROVEMENT: Before/after complexity estimates

Strategy:
${strategy.finalAnswer}`,
            userMessage: `Refactor this ${language} code:\n\`\`\`\n${code}\n\`\`\``,
            temperature: 0.3,
            maxTokens: 2500,
        });
        const codeChanges = this.extractChanges(code, refactored.content);
        return {
            success: true,
            output: refactored.content,
            agentUsed: 'refactoring',
            reasoning: strategy.steps.map(s => s.thought).join('\n'),
            codeChanges,
        };
    }
    extractChanges(original, response) {
        const match = response.match(/REFACTORED_CODE:\s*```[\w]*\n([\s\S]*?)```/);
        if (!match) {
            return [];
        }
        return [{
                description: 'Refactored code',
                original,
                improved: match[1].trim(),
            }];
    }
}
exports.RefactoringAgent = RefactoringAgent;
//# sourceMappingURL=RefactoringAgent.js.map