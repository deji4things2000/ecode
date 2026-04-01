import { AgentMemory } from '../core/AgentMemory';
import { ReasoningEngine } from '../core/ReasoningEngine';
import { AIProvider } from '../providers/AIProvider';
import { AgentResult, AgentTask, CodeChange } from './AgentOrchestrator';

export class RefactoringAgent {
    constructor(
        private readonly provider: AIProvider,
        private readonly memory: AgentMemory,
        private readonly reasoning: ReasoningEngine
    ) { }

    async execute(task: AgentTask): Promise<AgentResult> {
        const code = task.context ?? task.input;
        const language = task.language ?? 'code';

        // Plan refactoring strategy before writing code
        const strategy = await this.reasoning.reason(
            'Plan a comprehensive refactoring strategy',
            `Language: ${language}\n\nCode:\n${code}`,
            2
        );

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
            maxTokens: 2_500,
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

    private extractChanges(original: string, response: string): CodeChange[] {
        const match = response.match(/REFACTORED_CODE:\s*```[\w]*\n([\s\S]*?)```/);
        if (!match) { return []; }

        return [{
            description: 'Refactored code',
            original,
            improved: match[1].trim(),
        }];
    }
}