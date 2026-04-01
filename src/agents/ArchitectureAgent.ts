import { AIProvider } from '../providers/AIProvider';
import { AgentMemory } from '../core/AgentMemory';
import { ReasoningEngine } from '../core/ReasoningEngine';
import { AgentTask, AgentResult } from './AgentOrchestrator';

export class ArchitectureAgent {
    constructor(
        private readonly provider: AIProvider,
        private readonly memory: AgentMemory,
        private readonly reasoning: ReasoningEngine
    ) { }

    async execute(task: AgentTask): Promise<AgentResult> {
        const projectCtx = this.memory
            .getProjectContext()
            .map(m => m.content)
            .join('\n');

        // High-level architectural reasoning
        const archAnalysis = await this.reasoning.reason(
            'Perform comprehensive architectural analysis',
            `Project context:\n${projectCtx}\n\nInput:\n${task.input}\n\nCode:\n${task.context ?? ''}`,
            3
        );

        // Generate detailed recommendations
        const recommendations = await this.provider.complete({
            systemPrompt: `You are a solutions architect. Based on the analysis, provide:
1. ARCHITECTURE_ASSESSMENT: Current state evaluation
2. DESIGN_PATTERNS: Recommended patterns with rationale
3. SCALABILITY: How to scale this system
4. MIGRATION_PATH: Step-by-step improvement plan
5. DIAGRAM: ASCII diagram of recommended architecture
Be specific and actionable.`,
            userMessage: archAnalysis.finalAnswer,
            temperature: 0.5,
            maxTokens: 2_000,
        });

        return {
            success: true,
            output: this.formatReport(archAnalysis.finalAnswer, recommendations.content),
            agentUsed: 'architecture',
            reasoning: archAnalysis.steps.map(s => s.thought).join('\n'),
        };
    }

    private formatReport(analysis: string, recommendations: string): string {
        return [
            '# 🏗️ Architecture Analysis',
            '',
            '## Analysis',
            analysis,
            '',
            '## Recommendations',
            recommendations,
        ].join('\n');
    }
}