import * as vscode from 'vscode';
import { AgentOrchestrator } from './agents/AgentOrchestrator';
import { AgentMemory } from './core/AgentMemory';
import { WorkspaceScanner } from './core/WorkspaceScanner';
import { AIProvider } from './providers/AIProvider';
import { AnthropicProvider } from './providers/AnthropicProvider';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { AgentStatusBar } from './ui/AgentStatusBar'; // ← new
import { ChatPanel } from './ui/ChatPanel';
import { DiagnosticsManager } from './ui/DiagnosticsManager'; // ← new

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('Advanced AI Agent activating…');

    // ── Bootstrap core systems ────────────────────
    const config = vscode.workspace.getConfiguration('aiAgent');
    const memory = new AgentMemory(context, config.get('maxMemoryItems') ?? 50);
    const scanner = new WorkspaceScanner(memory);
    const provider = buildProvider(config);
    // Changed this one line in activate():
    const orchestrator = new AgentOrchestrator(provider, memory, context);  // ← added context

    // ── UI managers (order matters — diagnostics before status bar) ──
    const diagnosticsManager = new DiagnosticsManager(orchestrator, memory, context);
    const statusBar = new AgentStatusBar(memory, diagnosticsManager, context);

    // Start both managers
    diagnosticsManager.activate();
    statusBar.activate();

    // Push statusBar dispose into subscriptions
    context.subscriptions.push({ dispose: () => statusBar.dispose() });

    // ── Workspace scan on startup ─────────────────
    if (config.get<boolean>('enableAutoScan') !== false) {
        scanner.scanWorkspace().then(ctx => {
            if (ctx) {
                console.log(
                    `AI Agent scanned workspace: ${ctx.fileCount} files, ` +
                    `languages: ${ctx.languages.join(', ')}`
                );
                statusBar.setSuccess('Workspace scanned', 2_000);
            }
        });
    }

    // ── Helper: get code from active editor ───────
    function getEditorCode(editor: vscode.TextEditor): string {
        const sel = editor.selection;
        return sel.isEmpty
            ? editor.document.getText()
            : editor.document.getText(sel);
    }

    // ── Helper: run agent task with status bar feedback ──
    async function runWithProgress(
        label: string,
        fn: () => Promise<string>
    ): Promise<void> {
        try {
            const result = await statusBar.withProgress(label, fn, true);
            const doc = await vscode.workspace.openTextDocument({
                content: result,
                language: 'markdown',
            });
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
        } catch (err: any) {
            vscode.window.showErrorMessage(`AI Agent error: ${err.message}`);
        }
    }

    // ── Commands ──────────────────────────────────

    register('aiAgent.openChat', () => {
        ChatPanel.create(orchestrator, memory, context);
    });

    register('aiAgent.analyzeFile', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return warn('No active file to analyze.'); }

        const code = getEditorCode(editor);
        await runWithProgress('Analyzing code', async () => {
            const result = await orchestrator.execute({
                type: 'analysis',
                input: 'Perform deep code analysis',
                context: code,
                filePath: editor.document.fileName,
                language: editor.document.languageId,
            });
            return result.output;
        });
    });

    register('aiAgent.refactorCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return warn('No active file to refactor.'); }

        const code = getEditorCode(editor);
        await runWithProgress('Refactoring', async () => {
            const result = await orchestrator.execute({
                type: 'refactoring',
                input: 'Refactor and improve this code',
                context: code,
                filePath: editor.document.fileName,
                language: editor.document.languageId,
            });

            // Offer to apply refactored code directly
            if (result.codeChanges?.length) {
                const answer = await vscode.window.showInformationMessage(
                    'Apply refactored code to editor?',
                    'Apply', 'View Only'
                );
                if (answer === 'Apply') {
                    const improved = result.codeChanges[0].improved;
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(
                        editor.document.uri,
                        new vscode.Range(
                            editor.document.positionAt(0),
                            editor.document.positionAt(editor.document.getText().length)
                        ),
                        improved
                    );
                    await vscode.workspace.applyEdit(edit);
                    // Clear diagnostics for this file — code changed
                    diagnosticsManager.clearDiagnostics(editor.document.uri);
                }
            }
            return result.output;
        });
    });

    register('aiAgent.generateTests', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return warn('No active file.'); }

        const code = getEditorCode(editor);
        await runWithProgress('Generating tests', async () => {
            const result = await orchestrator.execute({
                type: 'testing',
                input: 'Generate a comprehensive test suite',
                context: code,
                filePath: editor.document.fileName,
                language: editor.document.languageId,
            });
            return result.output;
        });
    });

    register('aiAgent.debugCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return warn('No active file.'); }

        const code = getEditorCode(editor);
        await runWithProgress('Debugging', async () => {
            const result = await orchestrator.execute({
                type: 'debugging',
                input: 'Find and fix all bugs',
                context: code,
                filePath: editor.document.fileName,
                language: editor.document.languageId,
            });
            return result.output;
        });
    });

    register('aiAgent.analyzeArchitecture', async () => {
        await runWithProgress('Analyzing architecture', async () => {
            const result = await orchestrator.execute({
                type: 'architecture',
                input: 'Analyze the overall project architecture and provide recommendations',
            });
            return result.output;
        });
    });

    register('aiAgent.explainSelection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return warn('No active file.'); }

        const code = getEditorCode(editor);
        await runWithProgress('Explaining', async () => {
            const result = await orchestrator.execute({
                type: 'analysis',
                input: 'Explain what this code does in clear, simple terms',
                context: code,
                language: editor.document.languageId,
            });
            return result.output;
        });
    });

    register('aiAgent.clearMemory', async () => {
        await memory.clearAll();
        diagnosticsManager.clearAll();
        statusBar.setSuccess('Memory cleared', 2_000);
        vscode.window.showInformationMessage('🧹 AI Agent memory cleared.');
    });

    console.log('Advanced AI Agent is active!');
    vscode.window.showInformationMessage(
        '🤖 AI Agent ready! ' +
        'Open chat via the sidebar or Ctrl+Shift+P → "AI Agent: Open Chat"'
    );

    // ── Internal helpers ──────────────────────────

    function register(cmd: string, fn: (...args: unknown[]) => unknown): void {
        context.subscriptions.push(vscode.commands.registerCommand(cmd, fn));
    }

    function warn(msg: string): void {
        vscode.window.showWarningMessage(msg);
    }
}

// ─────────────────────────────────────────────
//  Provider factory
// ─────────────────────────────────────────────

function buildProvider(config: vscode.WorkspaceConfiguration): AIProvider {
    const primary = config.get<string>('primaryProvider') ?? 'openai';
    const openaiKey = config.get<string>('openaiApiKey') ?? '';
    const anthropicKey = config.get<string>('anthropicApiKey') ?? '';
    const model = config.get<string>('model') ?? 'gpt-4o';

    if (primary === 'anthropic' && anthropicKey) {
        return new AnthropicProvider(anthropicKey, model);
    }
    if (openaiKey) {
        return new OpenAIProvider(openaiKey, model);
    }

    console.warn('No API key configured — using mock provider.');
    return new MockProvider();
}

// ─────────────────────────────────────────────
//  Mock provider (zero-config testing)
// ─────────────────────────────────────────────

class MockProvider extends AIProvider {
    readonly name = 'mock';

    async complete(req: import('./providers/AIProvider').CompletionRequest) {
        await new Promise(res => setTimeout(res, 600));
        return {
            content: `🔧 **Mock Response** (add an API key in settings)\n\n${this.mockContent(req.userMessage)
                }`,
            model: 'mock-v1',
        };
    }

    private mockContent(prompt: string): string {
        const p = prompt.toLowerCase();
        if (p.includes('test')) { return '```javascript\ndescribe("suite", () => { it("works", () => expect(true).toBe(true)); });\n```'; }
        if (p.includes('refactor')) { return '```javascript\n// Extracted magic number\nconst MAX_RETRIES = 3;\n```'; }
        if (p.includes('bug')) { return 'Found: null-check missing before property access on line 7.'; }
        if (p.includes('architect')) { return 'Recommendation: layered architecture — Controller → Service → Repository.'; }
        if (p.includes('json') || p.includes('analyz')) { return '[]'; }  // empty diagnostics in mock mode
        return 'Add your OpenAI or Anthropic API key in VS Code settings to enable real AI responses.';
    }
}

export function deactivate(): void {
    console.log('Advanced AI Agent deactivated.');
}