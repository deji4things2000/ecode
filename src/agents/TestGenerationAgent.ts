import { AgentMemory } from '../core/AgentMemory';
import { AIProvider } from '../providers/AIProvider';
import { AgentResult, AgentTask } from './AgentOrchestrator';

export class TestGenerationAgent {
    constructor(
        private readonly provider: AIProvider,
        private readonly memory: AgentMemory
    ) { }

    async execute(task: AgentTask): Promise<AgentResult> {
        const code = task.context ?? task.input;
        const language = task.language ?? 'javascript';
        const history = this.memory.getFormattedHistory(4);

        // ── Run test generation passes in parallel ────
        const [unit, integration, edge] = await Promise.all([
            this.generateUnitTests(code, language, history),
            this.generateIntegrationTests(code, language, history),
            this.generateEdgeCaseTests(code, language, history),
        ]);

        const fullSuite = this.assembleSuite(unit, integration, edge, language);

        return {
            success: true,
            output: fullSuite,
            agentUsed: 'testing',
            suggestions: [
                'Run tests with your project test runner',
                'Add tests to CI/CD pipeline',
                'Aim for >80% coverage on critical paths',
            ],
            codeChanges: [{
                description: 'Generated test suite',
                original: '',
                improved: fullSuite,
            }],
        };
    }

    // ── Generation passes ─────────────────────────

    private generateUnitTests(
        code: string,
        language: string,
        history: Array<{ role: string; content: string }>
    ): Promise<string> {
        return this.provider.complete({
            systemPrompt: `You are a testing expert for ${language}.
Generate comprehensive unit tests using the appropriate framework (Jest/Vitest for JS/TS, pytest for Python, JUnit for Java, etc.).
Cover: happy path, boundary conditions, type validation.
Include descriptive test names and comments.`,
            userMessage: `Generate unit tests for:\n\`\`\`${language}\n${code}\n\`\`\``,
            history,
            temperature: 0.4,
            maxTokens: 1_200,
        }).then(r => r.content);
    }

    private generateIntegrationTests(
        code: string,
        language: string,
        history: Array<{ role: string; content: string }>
    ): Promise<string> {
        return this.provider.complete({
            systemPrompt: `You are an integration testing expert.
Generate integration tests that verify component interactions, API contracts, and data flow.
Use mocking/stubbing appropriately.`,
            userMessage: `Integration tests for:\n\`\`\`${language}\n${code}\n\`\`\``,
            history,
            temperature: 0.4,
            maxTokens: 800,
        }).then(r => r.content);
    }

    private generateEdgeCaseTests(
        code: string,
        language: string,
        history: Array<{ role: string; content: string }>
    ): Promise<string> {
        return this.provider.complete({
            systemPrompt: `You are a QA engineer specializing in edge cases.
Generate tests for: null/undefined inputs, empty collections, large inputs,
concurrent access, network failures, malformed data, and security edge cases.`,
            userMessage: `Edge case tests for:\n\`\`\`${language}\n${code}\n\`\`\``,
            history,
            temperature: 0.5,
            maxTokens: 800,
        }).then(r => r.content);
    }

    private assembleSuite(
        unit: string,
        integration: string,
        edge: string,
        language: string
    ): string {
        return [
            `# 🧪 Generated Test Suite (${language})`,
            '',
            '## Unit Tests',
            '```' + language,
            unit,
            '```',
            '',
            '## Integration Tests',
            '```' + language,
            integration,
            '```',
            '',
            '## Edge Case Tests',
            '```' + language,
            edge,
            '```',
        ].join('\n');
    }
}