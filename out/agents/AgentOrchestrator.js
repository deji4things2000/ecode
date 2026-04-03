"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentOrchestrator = void 0;
const vscode = __importStar(require("vscode"));
const ReasoningEngine_1 = require("../core/ReasoningEngine");
const ToolRegistry_1 = require("../core/ToolRegistry");
const CodeAnalysisAgent_1 = require("./CodeAnalysisAgent");
const RefactoringAgent_1 = require("./RefactoringAgent");
const TestGenerationAgent_1 = require("./TestGenerationAgent");
const DebugAgent_1 = require("./DebugAgent");
const ArchitectureAgent_1 = require("./ArchitectureAgent");
// ─────────────────────────────────────────────
//  AgentOrchestrator
// ─────────────────────────────────────────────
class AgentOrchestrator {
    // ─────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────
    constructor(provider, memory, vscodeCtx) {
        this.provider = provider;
        this.memory = memory;
        this.vscodeCtx = vscodeCtx;
        // ── Routing table ─────────────────────────────
        this.routingTable = [
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
        // ── Metrics ───────────────────────────────────
        this.executionCount = 0;
        this.taskHistory = [];
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        this.registry = new ToolRegistry_1.ToolRegistry(vscodeCtx, workspaceRoot);
        this.reasoning = new ReasoningEngine_1.ReasoningEngine(provider, memory);
        // Keep registry context in sync with active editor
        vscode.window.onDidChangeActiveTextEditor(editor => {
            this.registry.updateContext({
                activeFile: editor?.document.fileName,
                language: editor?.document.languageId,
            });
        });
        this.analysis = new CodeAnalysisAgent_1.CodeAnalysisAgent(provider, memory, this.reasoning);
        this.refactoring = new RefactoringAgent_1.RefactoringAgent(provider, memory, this.reasoning);
        this.testing = new TestGenerationAgent_1.TestGenerationAgent(provider, memory);
        this.debug = new DebugAgent_1.DebugAgent(provider, memory, this.reasoning, this.registry);
        this.architecture = new ArchitectureAgent_1.ArchitectureAgent(provider, memory, this.reasoning);
    }
    // ─────────────────────────────────────────────
    //  Provider hot-swap
    //  Called by extension.ts whenever the user
    //  picks a different provider in the quick-pick.
    //  Rebuilds every agent with the new provider so
    //  no state is lost (memory + registry unchanged).
    // ─────────────────────────────────────────────
    updateProvider(newProvider) {
        this.provider = newProvider;
        // Rebuild reasoning engine with new provider
        this.reasoning = new ReasoningEngine_1.ReasoningEngine(newProvider, this.memory);
        // Rebuild every specialist agent
        this.analysis = new CodeAnalysisAgent_1.CodeAnalysisAgent(newProvider, this.memory, this.reasoning);
        this.refactoring = new RefactoringAgent_1.RefactoringAgent(newProvider, this.memory, this.reasoning);
        this.testing = new TestGenerationAgent_1.TestGenerationAgent(newProvider, this.memory);
        this.debug = new DebugAgent_1.DebugAgent(newProvider, this.memory, this.reasoning, this.registry);
        this.architecture = new ArchitectureAgent_1.ArchitectureAgent(newProvider, this.memory, this.reasoning);
        console.log(`[AgentOrchestrator] Provider updated to: ${newProvider.name}`);
    }
    // ─────────────────────────────────────────────
    //  Public API
    // ─────────────────────────────────────────────
    async execute(task) {
        const startMs = Date.now();
        this.executionCount++;
        // Sync registry with task file context
        if (task.filePath) {
            this.registry.updateContext({
                activeFile: task.filePath,
                language: task.language,
            });
        }
        await this.persistTaskMemory(task);
        const enrichedTask = await this.enrichTask(task);
        let result;
        try {
            result = await this.route(enrichedTask);
        }
        catch (error) {
            result = this.buildErrorResult(task.type, error);
        }
        result.metadata = {
            ...(result.metadata ?? {}),
            durationMs: Date.now() - startMs,
            provider: this.provider.name,
        };
        if (result.success) {
            await this.persistResultMemory(task, result);
        }
        this.taskHistory.push({ task, result, timestamp: Date.now() });
        if (this.taskHistory.length > 100) {
            this.taskHistory.shift();
        }
        return result;
    }
    async chat(message, editorContext) {
        const memories = this.memory.getRelevantMemories(message, 5);
        const memCtx = memories.length
            ? memories.map(m => m.content).join('\n---\n')
            : undefined;
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
    async executeSequence(tasks, continueOnError = false) {
        const results = [];
        let previousOutput = '';
        for (const task of tasks) {
            const enriched = previousOutput
                ? {
                    ...task,
                    context: `${task.context ?? ''}\n\nPrevious step output:\n${previousOutput}`.trim(),
                }
                : task;
            const result = await this.execute(enriched);
            results.push(result);
            if (!result.success && !continueOnError) {
                break;
            }
            if (result.success) {
                previousOutput = result.output.slice(0, 1000);
            }
        }
        return results;
    }
    async executeParallel(tasks) {
        return Promise.all(tasks.map(task => this.execute(task)));
    }
    // ─────────────────────────────────────────────
    //  Routing
    // ─────────────────────────────────────────────
    async route(task) {
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
    async classifyIntent(message) {
        const sorted = [...this.routingTable].sort((a, b) => b.priority - a.priority);
        for (const entry of sorted) {
            if (entry.keywords.test(message)) {
                return entry.type;
            }
        }
        return 'general';
    }
    // ─────────────────────────────────────────────
    //  General handler
    // ─────────────────────────────────────────────
    async handleGeneral(task) {
        const toolsUsed = [];
        // Pull live diagnostics if we know the file
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
        const memories = this.memory.getRelevantMemories(task.input, 4);
        const memCtx = memories.length
            ? `\nRelevant past context:\n${memories.map(m => m.content).join('\n---\n')}`
            : '';
        const toolSchema = this.registry.getSchemaForPrompt('utility');
        const systemPrompt = [
            'You are an expert AI coding assistant with deep knowledge of software engineering.',
            'You have persistent memory of past interactions and access to workspace tools.',
            'Provide specific, actionable responses with code examples where appropriate.',
            '',
            'Available tools:',
            toolSchema,
            memCtx,
            diagnosticContext,
        ].filter(Boolean).join('\n');
        const userMessage = task.context
            ? `${task.input}\n\nCode context:\n\`\`\`${task.language ?? ''}\n${task.context}\n\`\`\``
            : task.input;
        const history = this.memory.getFormattedHistory(8);
        const response = await this.provider.complete({
            systemPrompt,
            userMessage,
            history,
            temperature: 0.7,
            maxTokens: 2000,
        });
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
    async enrichTask(task) {
        let enrichedContext = task.context ?? '';
        // Auto-read file if we have a path but no context
        if (task.filePath && !task.context) {
            const readResult = await this.registry.execute('readFile', {
                filePath: task.filePath,
                maxChars: 8000,
            });
            if (readResult.success) {
                enrichedContext = readResult.output;
            }
        }
        // Inject project-level memory
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
    detectLanguage(filePath) {
        if (!filePath) {
            return undefined;
        }
        const extMap = {
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
    async persistTaskMemory(task) {
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
    async persistResultMemory(task, result) {
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
    buildErrorResult(type, error) {
        console.error(`[AgentOrchestrator] ${type} agent failed:`, error);
        return {
            success: false,
            output: this.formatErrorMessage(error),
            agentUsed: type,
        };
    }
    formatErrorMessage(error) {
        const msg = error.message ?? '';
        if (msg.includes('401')) {
            return '⚠️ Invalid API key. Open Settings → aiAgent and check your key.';
        }
        if (msg.includes('429')) {
            return '⚠️ Rate limit reached. Wait a moment and try again.';
        }
        if (msg.includes('500')) {
            return '⚠️ AI provider server error. Try again shortly.';
        }
        if (msg.includes('ENOTFOUND') || msg.includes('ETIMEDOUT')) {
            return '⚠️ Network error. Check your internet connection.';
        }
        if (msg.includes('not running') || msg.includes('ECONNREFUSED')) {
            return `⚠️ Local AI server not running.\n${msg}`;
        }
        return `⚠️ Agent error: ${msg}`;
    }
    // ─────────────────────────────────────────────
    //  Public utilities
    // ─────────────────────────────────────────────
    getRegistry() { return this.registry; }
    getStats() {
        const byType = {};
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
            activeProvider: this.provider.name,
            recentTasks: this.taskHistory
                .slice(-5)
                .map(h => ({
                type: h.task.type,
                success: h.result.success,
                durationMs: h.result.metadata?.durationMs,
            })),
        };
    }
    async clearAll() {
        await this.memory.clearAll();
        this.taskHistory.length = 0;
        this.executionCount = 0;
    }
}
exports.AgentOrchestrator = AgentOrchestrator;
//# sourceMappingURL=AgentOrchestrator.js.map