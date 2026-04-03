"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArchitectureAgent = void 0;
class ArchitectureAgent {
    constructor(provider, memory, reasoning) {
        this.provider = provider;
        this.memory = memory;
        this.reasoning = reasoning;
    }
    async execute(task) {
        const projectCtx = this.memory
            .getProjectContext()
            .map(m => m.content)
            .join('\n');
        // High-level architectural reasoning
        const archAnalysis = await this.reasoning.reason('Perform comprehensive architectural analysis', `Project context:\n${projectCtx}\n\nInput:\n${task.input}\n\nCode:\n${task.context ?? ''}`, 3);
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
            maxTokens: 2000,
        });
        return {
            success: true,
            output: this.formatReport(archAnalysis.finalAnswer, recommendations.content),
            agentUsed: 'architecture',
            reasoning: archAnalysis.steps.map(s => s.thought).join('\n'),
        };
    }
    formatReport(analysis, recommendations) {
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
exports.ArchitectureAgent = ArchitectureAgent;
//# sourceMappingURL=ArchitectureAgent.js.map