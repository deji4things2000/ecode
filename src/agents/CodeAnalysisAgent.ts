import { AgentMemory } from '../core/AgentMemory';
import { ReasoningEngine } from '../core/ReasoningEngine';
import { AIProvider } from '../providers/AIProvider';
import { AgentResult, AgentTask } from './AgentOrchestrator';

export class CodeAnalysisAgent {
    constructor(
        private readonly provider: AIProvider,
        private readonly memory: AgentMemory,
        private readonly reasoning: ReasoningEngine
    ) { }

    async execute(task: AgentTask): Promise<AgentResult> {
        const code = task.context ?? task.input;
        const history = this.memory.getFormattedHistory(4);

        // ── Parallel analysis passes ──────────────────
        const [quality, security, performance] = await Promise.all([
            this.analyzeQuality(code, history),
            this.analyzeSecurity(code, history),
            this.analyzePerformance(code, history),
        ]);

        // ── Multi-step reasoning over findings ────────
        const reasoningResult = await this.reasoning.reason(
            'Synthesize code analysis findings into actionable recommendations',
            `Quality:\n${quality}\n\nSecurity:\n${security}\n\nPerformance:\n${performance}`,
            2
        );

        const suggestions = this.extractSuggestions(reasoningResult.finalAnswer);

        return {
            success: true,
            output: this.formatReport(quality, security, performance, reasoningResult.finalAnswer),
            agentUsed: 'analysis',
            reasoning: reasoningResult.steps.map(s => s.thought).join('\n'),
            suggestions,
        };
    }

    // ── Analysis passes ───────────────────────────

    private async analyzeQuality(
        code: string,
        history: Array<{ role: string; content: string }>
    ): Promise<string> {
        return this.provider.complete({
            systemPrompt: `You are a code quality expert. Analyze for:
- Code smells and anti-patterns
- SOLID principle violations
- Naming conventions
- Complexity metrics
- Documentation gaps
Be specific with line-level feedback.`,
            userMessage: `Analyze this code:\n\`\`\`\n${code}\n\`\`\``,
            history,
            temperature: 0.3,
            maxTokens: 800,
        }).then(r => r.content);
    }

    private async analyzeSecurity(
        code: string,
        history: Array<{ role: string; content: string }>
    ): Promise<string> {
        return this.provider.complete({
            systemPrompt: `You are a security expert. Check for:
- Injection vulnerabilities (SQL, XSS, command)
- Insecure data handling and exposure
- Authentication/authorization flaws
- Cryptographic weaknesses
- Dependency vulnerabilities
Rate each finding: CRITICAL | HIGH | MEDIUM | LOW`,
            userMessage: `Security audit:\n\`\`\`\n${code}\n\`\`\``,
            history,
            temperature: 0.2,
            maxTokens: 600,
        }).then(r => r.content);
    }

    private async analyzePerformance(
        code: string,
        history: Array<{ role: string; content: string }>
    ): Promise<string> {
        return this.provider.complete({
            systemPrompt: `You are a performance optimization expert. Identify:
- Algorithmic complexity issues (O-notation)
- Memory leaks and excessive allocations
- Unnecessary re-renders or recomputations
- Database query inefficiencies
- Blocking operations in async contexts`,
            userMessage: `Performance review:\n\`\`\`\n${code}\n\`\`\``,
            history,
            temperature: 0.3,
            maxTokens: 600,
        }).then(r => r.content);
    }

    // ── Formatting helpers ────────────────────────

    private formatReport(
        quality: string,
        security: string,
        performance: string,
        synthesis: string
    ): string {
        return [
            '# 🔍 Deep Code Analysis Report',
            '',
            '## 📊 Code Quality',
            quality,
            '',
            '## 🔒 Security Audit',
            security,
            '',
            '## ⚡ Performance Review',
            performance,
            '',
            '## 🧠 AI Synthesis & Recommendations',
            synthesis,
        ].join('\n');
    }

    private extractSuggestions(text: string): string[] {
        const lines = text.split('\n');
        return lines
            .filter(l => /^[-*•\d+\.]/.test(l.trim()))
            .map(l => l.replace(/^[-*•\d+\.]\s*/, '').trim())
            .filter(l => l.length > 10)
            .slice(0, 8);
    }
}