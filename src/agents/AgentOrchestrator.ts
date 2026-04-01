import * as vscode from 'vscode';
import { AgentMemory } from '../core/AgentMemory';
import { ReasoningEngine } from '../core/ReasoningEngine';
import { ToolRegistry } from '../core/ToolRegistry';
import { AIProvider } from '../providers/AIProvider';
import { ArchitectureAgent } from './ArchitectureAgent';
import { CodeAnalysisAgent } from './CodeAnalysisAgent';
import { DebugAgent } from './DebugAgent';
import { RefactoringAgent } from './RefactoringAgent';
import { TestGenerationAgent } from './TestGenerationAgent';

// ─────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────

export type AgentType =
    | 'analysis'
    | 'refactoring'
    | 'testing'
    | 'debugging'
    | 'architecture'
    | 'general';

export interface AgentTask {
    type: AgentType;
    input: string;
    context?: string;
    filePath?: string;
    language?: string;
}

export interface AgentResult {
    success: boolean;
    output: string;
    agentUsed: AgentType;
    reasoning?: string;
    suggestions?: string[];
    codeChanges?: CodeChange[];
    toolsUsed?: string[];      // names of ToolRegistry tools invoked
    metadata?: AgentMetadata;
}

export interface CodeChange {
    description: string;
    original: string;
    improved: string;
    line?: number;
}

export interface AgentMetadata {
    durationMs: number;
    tokensEstimate?: number;
    provider: string;
    model?: string;
}

// Internal routing table entry
interface RouteEntry {
    keywords: RegExp;
    type: AgentType;
    priority: number;   // higher = checked first
}

// ─────────────────────────────────────────────
//  AgentOrchestrator
// ─────────────────────────────────────────────

export class AgentOrchestrator {
    // ── Sub-agents ────────────────────────────────
    private readonly reasoning: ReasoningEngine;
    private readonly registry: ToolRegistry;
    private readonly analysis: CodeAnalysisAgent;
    private readonly refactoring: RefactoringAgent;
    private readonly testing: TestGenerationAgent;
    private readonly debug: DebugAgent;
    private readonly architecture: ArchitectureAgent;

    // ── Intent routing table ──────────────────────
    private readonly routingTable: RouteEntry[] = [
        {
            keywords: /\b(unit\s*test|integration\s*test|test\s*suite|spec|jest|vitest|mocha|pytest|junit|coverage)\b/i,
            type: 'testing',
            priority: 10,
        },
        {
            keywords: /\b(bug|fix|broken|crash|exception|error|fault|issue|null\s*pointer|undefined|traceback|stack\s*trace|debug)\b/i,
            type: 'debugging',
            priority: 9,
        },
        {
            keywords: /\b(refactor|clean\s*up|rewrite|restructure|simplif|optimiz|improve|dry|solid|extract|rename|decompos)\b/i,
            type: 'refactoring',
            priority: 8,
        },
        {
            keywords: /\b(architect|design\s*pattern|system\s*design|scalab|microservice|monolith|diagram|structure|folder\s*layout|project\s*layout)\b/i,
            type: 'architecture',
            priority: 7,
        },
        {
            keywords: /\b(explain|what\s*does|how\s*does|analyze|review|audit|understand|describe|summarize|document)\b/i,
            type: 'analysis',
            priority: 6,
        },
    ];

    // ── Execution metrics ─────────────────────────
    private executionCount = 0;
    private readonly taskHistory: Array<{
        task: AgentTask;
        result: AgentResult;
        timestamp: number;
    }> = [];

    // ─────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────

    constructor(
        private readonly provider: AIProvider,
        private readonly memory: AgentMemory,
        private readonly vscodeContext: vscode.ExtensionContext
    ) {
        const workspaceRoot =
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        // ── Core systems ──────────────────────────────
        this.reasoning = new ReasoningEngine(provider, memory);
        this.registry = new ToolRegistry(vscodeContext, workspaceRoot);

        // ── Sync registry context whenever active editor changes ──
        vscode.window.onDidChangeActiveTextEditor(editor => {
            this.registry.updateContext({
                activeFile: editor?.document.fileName,
                language: editor?.document.languageId,
            });
        }, null, []);

        // ── Specialist agents (each receives the tools they need) ──
        this.analysis = new CodeAnalysisAgent(
            provider, memory, this.reasoning, this.registry
        );
        this.refactoring = new RefactoringAgent(
            provider, memory, this.reasoning, this.registry
        );
        this.testing = new TestGenerationAgent(
            provider, memory, this.registry
        );
        this.debug = new DebugAgent(
            provider, memory, this.reasoning, this.registry
        );
        this.architecture = new ArchitectureAgent(
            provider, memory, this.reasoning, this.registry
        );
    }

    // ─────────────────────────────────────────────
    //  Public API
    // ─────────────────────────────────────────────

    /**
     * Primary entry point. Routes a structured task to the correct
     * specialist agent, enriches it with memory context, records the
     * execution, and returns a fully-formed AgentResult.
     */
    async execute(task: AgentTask): Promise<AgentResult> {
        const startMs = Date.now();
        this.executionCount++;

        // Sync registry with task's file context
        if (task.filePath) {
            this.registry.updateContext({
                activeFile: task.filePath,
                language: task.language,
            });
        }

        // Store task intent in memory for future context
        await this.persistTaskMemory(task);

        // Enrich task with additional workspace context when available
        const enrichedTask = await this.enrichTask(task);

        let result: AgentResult;

        try {
            result = await this.route(enrichedTask);
        } catch (error: any) {
            result = this.buildErrorResult(task.type, error);
        }

        // Attach timing metadata
        result.metadata = {
            ...(result.metadata ?? {}),
            durationMs: Date.now() - startMs,
            provider: this.provider.name,
        };

        // Persist successful results
        if (result.success) {
            await this.persistResultMemory(task, result);
        }

        // Record in local history
        this.taskHistory.push({ task, result, timestamp: Date.now() });
        if (this.taskHistory.length > 100) {
            this.taskHistory.shift();   // cap at 100 entries
        }

        return result;
    }

    /**
     * Free-form chat interface. Classifies the user message
     * automatically and delegates to execute().
     */
    async chat(
        message: string,
        editorContext?: string
    ): Promise<AgentResult> {
        // Pull relevant memories for context injection
        const memories = this.memory.getRelevantMemories(message, 5);
        const memCtx = memories.length
            ? memories.map(m => m.content).join('\n---\n')
            : undefined;

        // Merge editor code with memory context
        const combinedContext = [editorContext, memCtx]
            .filter(Boolean)
            .join('\n\n--- Memory Context ---\n');

        const agentType = await this.classifyIntent(message);

        return this.execute({
            type: agentType,
            input: message,
            context: combinedContext || undefined,
        });
    }

    /**
     * Execute a sequence of tasks in order.
     * Subsequent tasks can reference earlier results via the context field.
     */
    async executeSequence(
        tasks: AgentTask[],
        continueOnError = false
    ): Promise<AgentResult[]> {
        const results: AgentResult[] = [];
        let previousOutput = '';

        for (const task of tasks) {
            // Thread previous output into the next task as context
            const enriched: AgentTask = previousOutput
                ? { ...task, context: `${task.context ?? ''}\n\nPrevious step output:\n${previousOutput}`.trim() }
                : task;

            const result = await this.execute(enriched);
            results.push(result);

            if (!result.success && !continueOnError) { break; }
            if (result.success) { previousOutput = result.output.slice(0, 1_000); }
        }

        return results;
    }

    /**
     * Run multiple independent tasks in parallel.
     * Useful when tasks do not depend on each other's output.
     */
    async executeParallel(tasks: AgentTask[]): Promise<AgentResult[]> {
        return Promise.all(tasks.map(task => this.execute(task)));
    }

    // ─────────────────────────────────────────────
    //  Routing
    // ─────────────────────────────────────────────

    /**
     * Dispatch to the correct specialist based on task.type.
     */
    private async route(task: AgentTask): Promise<AgentResult> {
        switch (task.type) {
            case 'analysis': return this.analysis.execute(task);
            case 'refactoring': return this.refactoring.execute(task);
            case 'testing': return this.testing.execute(task);
            case 'debugging': return this.debug.execute(task);
            case 'architecture': return this.architecture.execute(task);
            case 'general':
            default: return this.handleGeneral(task);
        }
    }

    /**
     * Classify free-form input into an AgentType.
     *
     * Strategy (in order):
     *   1. Keyword routing table  — zero latency, no API call
     *   2. Active file language heuristics
     *   3. Falls back to 'general'
     */
    private async classifyIntent(message: string): Promise<AgentType> {
        // Sort descending by priority so highest-priority rules win
        const sorted = [...this.routingTable].sort((a, b) => b.priority - a.priority);

        for (const entry of sorted) {
            if (entry.keywords.test(message)) {
                return entry.type;
            }
        }

        // Language-based heuristic (e.g. user pastes code → analysis)
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && message.length < 80 && !message.includes(' ')) {
            // Very short messages with no spaces are likely symbol names → analysis
            return 'analysis';
        }

        return 'general';
    }

    // ─────────────────────────────────────────────
    //  General handler
    // ─────────────────────────────────────────────

    private async handleGeneral(task: AgentTask): Promise<AgentResult> {
        const toolsUsed: string[] = [];

        // ── Pull context from tools ────────────────────

        // 1. Active file diagnostics
        let diagnosticContext = '';
        if (task.filePath) {
            const diagResult = await this.registry.execute('getDiagnostics', {
                filePath: task.filePath,
                severity: 'all',
            });
            if (diagResult.success && diagResult.output !== 'No diagnostics found.') {
                diagnosticContext = `\nCurrent diagnostics:\n${diagResult.output}`;
                toolsUsed.push('getDiagnostics');
            }
        }

        // 2. Relevant memories
        const memories = this.memory.getRelevantMemories(task.input, 4);
        const memCtx = memories.length
            ? `\nRelevant past context:\n${memories.map(m => m.content).join('\n---\n')}`
            : '';

        // 3. Tool schema so AI can request specific tools if needed
        const toolSchema = this.registry.getSchemaForPrompt('utility');

        // ── Build system prompt ────────────────────────
        const systemPrompt = [
            'You are an expert AI coding assistant with deep knowledge of software engineering.',
            'You have persistent memory of past interactions and access to workspace tools.',
            'Provide specific, actionable responses with code examples where appropriate.',
            '',
            'Available utility tools you can reference:',
            toolSchema,
            memCtx,
            diagnosticContext,
        ].filter(Boolean).join('\n');

        // ── Compose user message ───────────────────────
        const userMessage = task.context
            ? `${task.input}\n\nCode context:\n\`\`\`${task.language ?? ''}\n${task.context}\n\`\`\``
            : task.input;

        // ── Call AI ────────────────────────────────────
        const history = this.memory.getFormattedHistory(8);
        const response = await this.provider.complete({
            systemPrompt,
            userMessage,
            history,
            temperature: 0.7,
            maxTokens: 2_000,
        });

        // ── Persist conversation turn ──────────────────
        this.memory.addConversationTurn({ role: 'user', content: task.input });
        this.memory.addConversationTurn({ role: 'assistant', content: response.content });

        return {
            success: true,
            output: response.content,
            agentUsed: 'general',
            toolsUsed,
        };
    }

    // ─────────────────────────────────────────────
    //  Task enrichment
    // ─────────────────────────────────────────────

    /**
     * Augment the task with additional context before routing:
     *   - File content (when not already provided)
     *   - Project-level memory
     *   - Current diagnostics for the file
     */
    private async enrichTask(task: AgentTask): Promise<AgentTask> {
        let enrichedContext = task.context ?? '';

        // Auto-read file content if we have a path but no context yet
        if (task.filePath && !task.context) {
            const readResult = await this.registry.execute('readFile', {
                filePath: task.filePath,
                maxChars: 8_000,
            });
            if (readResult.success) {
                enrichedContext = readResult.output;
            }
        }

        // Inject project-level memory summaries
        const projectCtx = this.memory
            .getProjectContext()
            .map(m => m.content)
            .join('\n');

        if (projectCtx) {
            enrichedContext = enrichedContext
                ? `${enrichedContext}\n\n--- Project Context ---\n${projectCtx}`
                : projectCtx;
        }

        return {
            ...task,
            context: enrichedContext || undefined,
            language: task.language ?? this.detectLanguage(task.filePath),
        };
    }

    /**
     * Infer language from file extension when not explicitly provided.
     */
    private detectLanguage(filePath?: string): string | undefined {
        if (!filePath) { return undefined; }

        const extMap: Record<string, string> = {
            ts: 'typescript', tsx: 'typescript',
            js: 'javascript', jsx: 'javascript',
            py: 'python', java: 'java',
            cs: 'csharp', go: 'go',
            rs: 'rust', cpp: 'cpp',
            c: 'c', rb: 'ruby',
            php: 'php', swift: 'swift',
            kt: 'kotlin', vue: 'vue',
            svelte: 'svelte',
        };

        const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
        return extMap[ext];
    }

    // ─────────────────────────────────────────────
    //  Memory persistence
    // ─────────────────────────────────────────────

    private async persistTaskMemory(task: AgentTask): Promise<void> {
        await this.memory.addMemory({
            type: 'conversation',
            content: `[${task.type}] ${task.input.slice(0, 200)}`,
            metadata: {
                timestamp: Date.now(),
                filePath: task.filePath,
                language: task.language,
                importance: 5,
                tags: [task.type, task.language ?? 'unknown', 'task'],
            },
        });
    }

    private async persistResultMemory(
        task: AgentTask,
        result: AgentResult
    ): Promise<void> {
        await this.memory.addMemory({
            type: 'codeAnalysis',
            content: result.output.slice(0, 600),
            metadata: {
                timestamp: Date.now(),
                filePath: task.filePath,
                language: task.language,
                importance: 8,
                tags: [task.type, 'result', task.language ?? 'unknown'],
            },
        });
    }

    // ─────────────────────────────────────────────
    //  Error handling
    // ─────────────────────────────────────────────

    private buildErrorResult(type: AgentType, error: Error): AgentResult {
        console.error(`[AgentOrchestrator] ${type} agent failed:`, error);
        return {
            success: false,
            output: this.formatErrorMessage(error),
            agentUsed: type,
        };
    }

    private formatErrorMessage(error: Error): string {
        // Surface helpful messages for common API errors
        const msg = error.message ?? '';

        if (msg.includes('401')) { return '⚠️ Invalid API key. Check your settings (Ctrl+,  → "aiAgent").'; }
        if (msg.includes('429')) { return '⚠️ Rate limit reached. Please wait a moment and try again.'; }
        if (msg.includes('500')) { return '⚠️ AI provider server error. Try again shortly.'; }
        if (msg.includes('ENOTFOUND') || msg.includes('ETIMEDOUT')) {
            return '⚠️ Network error. Check your internet connection.';
        }

        return `⚠️ Agent error: ${msg}`;
    }

    // ─────────────────────────────────────────────
    //  Public utilities
    // ─────────────────────────────────────────────

    /** Expose registry for direct tool access from extension commands. */
    getRegistry(): ToolRegistry {
        return this.registry;
    }

    /** Aggregate stats for the status bar / diagnostics panel. */
    getStats(): Record<string, unknown> {
        const byType: Record<string, number> = {};
        this.taskHistory.forEach(({ task }) => {
            byType[task.type] = (byType[task.type] ?? 0) + 1;
        });

        const successCount = this.taskHistory.filter(h => h.result.success).length;

        return {
            totalExecutions: this.executionCount,
            successRate: this.taskHistory.length
                ? `${Math.round((successCount / this.taskHistory.length) * 100)}%`
                : 'n/a',
            byAgentType: byType,
            memoryStats: this.memory.getStats(),
            toolStats: this.registry.getStats(),
            recentTasks: this.taskHistory
                .slice(-5)
                .map(h => ({
                    type: h.task.type,
                    success: h.result.success,
                    durationMs: h.result.metadata?.durationMs,
                })),
        };
    }

    /** Clear all state — called when the user triggers "Clear Memory". */
    async clearAll(): Promise<void> {
        await this.memory.clearAll();
        this.taskHistory.length = 0;
        this.executionCount = 0;
    }
}