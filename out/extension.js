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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const AgentMemory_1 = require("./core/AgentMemory");
const WorkspaceScanner_1 = require("./core/WorkspaceScanner");
const AgentOrchestrator_1 = require("./agents/AgentOrchestrator");
const ChatPanel_1 = require("./ui/ChatPanel");
const DiagnosticsManager_1 = require("./ui/DiagnosticsManager");
const AgentStatusBar_1 = require("./ui/AgentStatusBar");
const ProviderRegistry_1 = require("./providers/ProviderRegistry");
const ProviderQuickPick_1 = require("./ui/ProviderQuickPick");
const ProviderSelectorPanel_1 = require("./ui/ProviderSelectorPanel");
// ─────────────────────────────────────────────
//  Extension lifecycle
// ─────────────────────────────────────────────
async function activate(context) {
    console.log('Advanced AI Agent activating…');
    // ── Configuration ─────────────────────────────
    const config = vscode.workspace.getConfiguration('aiAgent');
    // ── Memory (must come first — other systems depend on it) ──
    const memory = new AgentMemory_1.AgentMemory(context, config.get('maxMemoryItems') ?? 50);
    const scanner = new WorkspaceScanner_1.WorkspaceScanner(memory);
    // ── Provider registry ─────────────────────────
    // Always start with Mock (always works). Then try to restore or use configured provider,
    // but ONLY if we can verify it's actually available.
    const mockProvider = {
        name: 'mock',
        async complete(req) {
            await new Promise(r => setTimeout(r, 500));
            return { content: '🎮 **Demo Mode Active**\n\nThis is mock AI — responses are simulated.\n\n**To use real AI:** Click the **📋 Provider** button in the chat header and select an AI provider (Ollama, OpenAI, Anthropic, etc.).', model: 'mock-v1' };
        },
        async ask(prompt) {
            return 'Demo Mode: Use the 📋 Provider button in chat to select a real AI provider.';
        },
    };
    const providerRegistry = new ProviderRegistry_1.ProviderRegistry(context, mockProvider, 'mock');
    // Try to restore the user's last provider, but validate it first
    const saved = context.globalState.get('aiAgent.activeProvider');
    if (saved && saved !== 'mock') {
        try {
            // Detect status quickly to see if provider is available
            const catalogue = providerRegistry.getCatalogue();
            const meta = catalogue.find(p => p.id === saved);
            if (meta) {
                await providerRegistry.detectStatus(meta);
                // Only restore if status is 'ready', otherwise stay on mock
                if (meta.status === 'ready') {
                    try {
                        await providerRegistry.switchProvider(saved);
                        console.log(`[AI Agent] Restored provider: ${meta.displayName}`);
                    }
                    catch (err) {
                        console.log(`[AI Agent] Failed to restore ${meta.displayName}, using mock.`);
                    }
                }
                else {
                    console.log(`[AI Agent] Provider ${meta.displayName} not available (${meta.status}), using mock.`);
                }
            }
        }
        catch (err) {
            console.log(`[AI Agent] Error checking saved provider, using mock.`);
        }
    }
    // If still on mock and a non-mock provider is configured, try to use it
    if (providerRegistry.getProviderID() === 'mock') {
        const configuredID = config.get('primaryProvider');
        if (configuredID && configuredID !== 'mock') {
            try {
                const catalogue = providerRegistry.getCatalogue();
                const meta = catalogue.find(p => p.id === configuredID);
                if (meta) {
                    await providerRegistry.detectStatus(meta);
                    if (meta.status === 'ready') {
                        await providerRegistry.switchProvider(configuredID);
                        console.log(`[AI Agent] Using configured provider: ${meta.displayName}`);
                    }
                }
            }
            catch (err) {
                console.log(`[AI Agent] Primary provider not available, using mock.`);
            }
        }
    }
    // ── Orchestrator ──────────────────────────────
    const orchestrator = new AgentOrchestrator_1.AgentOrchestrator(providerRegistry.getProvider(), memory, context);
    // Re-wire orchestrator whenever the user switches provider
    providerRegistry.onProviderChange((_id, newProvider) => {
        orchestrator.updateProvider(newProvider);
    });
    // ── UI ────────────────────────────────────────
    const diagnosticsManager = new DiagnosticsManager_1.DiagnosticsManager(orchestrator, memory, context);
    const statusBar = new AgentStatusBar_1.AgentStatusBar(memory, diagnosticsManager, context);
    const quickPick = new ProviderQuickPick_1.ProviderQuickPick(providerRegistry);
    diagnosticsManager.activate();
    statusBar.activate();
    // Provider quick pick doesn't need activation, but it does need to be instantiated
    // Add this command registration inside activate()
    register('aiAgent.openProviderSelector', () => {
        ProviderSelectorPanel_1.ProviderSelectorPanel.create(providerRegistry, context);
    });
    // Keep status bar provider label in sync
    providerRegistry.onProviderChange(() => {
        const meta = providerRegistry.getMeta();
        statusBar.setProviderLabel(`${meta.icon} ${meta.displayName}`);
    });
    // Initialise the label immediately with whatever provider loaded
    statusBar.setProviderLabel(`${providerRegistry.getMeta().icon} ${providerRegistry.getMeta().displayName}`);
    context.subscriptions.push({ dispose: () => statusBar.dispose() });
    // ── Workspace scan ────────────────────────────
    if (config.get('enableAutoScan') !== false) {
        scanner.scanWorkspace().then(ctx => {
            if (ctx) {
                console.log(`AI Agent scanned workspace: ${ctx.fileCount} files, ` +
                    `languages: ${ctx.languages.join(', ')}`);
                statusBar.setSuccess('Workspace scanned', 2000);
            }
        });
    }
    // ─────────────────────────────────────────────
    //  Shared helpers
    // ─────────────────────────────────────────────
    function getEditorCode(editor) {
        const sel = editor.selection;
        return sel.isEmpty
            ? editor.document.getText()
            : editor.document.getText(sel);
    }
    /**
     * Run an agent task with a status-bar spinner + progress notification,
     * then open the markdown result in a side panel.
     */
    async function runWithProgress(label, fn) {
        try {
            const result = await statusBar.withProgress(label, fn, true);
            const doc = await vscode.workspace.openTextDocument({
                content: result,
                language: 'markdown',
            });
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
        }
        catch (err) {
            vscode.window.showErrorMessage(`AI Agent: ${err.message}`);
        }
    }
    function register(cmd, fn) {
        context.subscriptions.push(vscode.commands.registerCommand(cmd, fn));
    }
    function warn(msg) {
        vscode.window.showWarningMessage(msg);
    }
    // ─────────────────────────────────────────────
    //  Commands
    // ─────────────────────────────────────────────
    // ── Chat panel ────────────────────────────────
    register('aiAgent.openChat', () => {
        ChatPanel_1.ChatPanel.create(orchestrator, memory, providerRegistry, context);
    });
    // ── Provider / model switching ────────────────
    register('aiAgent.selectProvider', () => {
        quickPick.show();
    });
    register('aiAgent.selectModel', () => {
        quickPick.showModelPicker();
    });
    // ── Code analysis ─────────────────────────────
    register('aiAgent.analyzeFile', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return warn('No active file to analyze.');
        }
        await runWithProgress('Analyzing code', async () => {
            const result = await orchestrator.execute({
                type: 'analysis',
                input: 'Perform deep code analysis',
                context: getEditorCode(editor),
                filePath: editor.document.fileName,
                language: editor.document.languageId,
            });
            return result.output;
        });
    });
    // ── Refactoring ───────────────────────────────
    register('aiAgent.refactorCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return warn('No active file to refactor.');
        }
        await runWithProgress('Refactoring', async () => {
            const result = await orchestrator.execute({
                type: 'refactoring',
                input: 'Refactor and improve this code',
                context: getEditorCode(editor),
                filePath: editor.document.fileName,
                language: editor.document.languageId,
            });
            // Offer to apply if the agent produced code changes
            if (result.codeChanges?.length) {
                const answer = await vscode.window.showInformationMessage('Apply refactored code to editor?', 'Apply', 'View Only');
                if (answer === 'Apply') {
                    const improved = result.codeChanges[0].improved;
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(editor.document.uri, new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length)), improved);
                    await vscode.workspace.applyEdit(edit);
                    diagnosticsManager.clearDiagnostics(editor.document.uri);
                    vscode.window.showInformationMessage('✅ Refactoring applied.');
                }
            }
            return result.output;
        });
    });
    // ── Test generation ───────────────────────────
    register('aiAgent.generateTests', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return warn('No active file.');
        }
        await runWithProgress('Generating tests', async () => {
            const result = await orchestrator.execute({
                type: 'testing',
                input: 'Generate a comprehensive test suite',
                context: getEditorCode(editor),
                filePath: editor.document.fileName,
                language: editor.document.languageId,
            });
            return result.output;
        });
    });
    // ── Debugging ─────────────────────────────────
    register('aiAgent.debugCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return warn('No active file.');
        }
        await runWithProgress('Debugging', async () => {
            const result = await orchestrator.execute({
                type: 'debugging',
                input: 'Find and fix all bugs',
                context: getEditorCode(editor),
                filePath: editor.document.fileName,
                language: editor.document.languageId,
            });
            return result.output;
        });
    });
    // ── Architecture analysis ─────────────────────
    register('aiAgent.analyzeArchitecture', async () => {
        await runWithProgress('Analyzing architecture', async () => {
            const result = await orchestrator.execute({
                type: 'architecture',
                input: 'Analyze the overall project architecture and provide recommendations',
            });
            return result.output;
        });
    });
    // ── Explain selection ─────────────────────────
    register('aiAgent.explainSelection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return warn('No active file.');
        }
        await runWithProgress('Explaining', async () => {
            const result = await orchestrator.execute({
                type: 'analysis',
                input: 'Explain what this code does in clear, simple terms',
                context: getEditorCode(editor),
                language: editor.document.languageId,
            });
            return result.output;
        });
    });
    // ── Clear memory ──────────────────────────────
    register('aiAgent.clearMemory', async () => {
        await orchestrator.clearAll();
        diagnosticsManager.clearAll();
        statusBar.setSuccess('Memory cleared', 2000);
        vscode.window.showInformationMessage('🧹 AI Agent memory cleared.');
    });
    // ─────────────────────────────────────────────
    //  Ready notification
    // ─────────────────────────────────────────────
    const meta = providerRegistry.getMeta();
    console.log(`Advanced AI Agent ready — ${meta.icon} ${meta.displayName}`);
    // Auto-open chat on first activation
    vscode.window.showInformationMessage(`${meta.icon} AI Agent ready! Start coding.`, 'Open Chat').then(btn => {
        if (btn === 'Open Chat') {
            ChatPanel_1.ChatPanel.create(orchestrator, memory, providerRegistry, context);
        }
    });
}
// ─────────────────────────────────────────────
//  Deactivation
// ─────────────────────────────────────────────
function deactivate() {
    console.log('Advanced AI Agent deactivated.');
}
//# sourceMappingURL=extension.js.map