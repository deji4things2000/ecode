import * as path from 'path';
import * as vscode from 'vscode';
import { AgentOrchestrator } from '../agents/AgentOrchestrator';
import { AgentMemory } from '../core/AgentMemory';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { ProviderSelectorPanel } from './ProviderSelectorPanel';

export class ChatPanel {
    private static instance: ChatPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private isDisposed = false;

    private constructor(
        private readonly orchestrator: AgentOrchestrator,
        private readonly memory: AgentMemory,
        private readonly providerRegistry: ProviderRegistry,
        private readonly context: vscode.ExtensionContext
    ) {
        this.panel = vscode.window.createWebviewPanel(
            'aiAgentChat',
            '🤖 AI Agent Chat',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(context.extensionPath, 'webview')),
                ],
            }
        );

        this.panel.webview.html = this.loadWebview();
        this.registerMessageHandlers();

        this.panel.onDidDispose(() => {
            this.isDisposed = true;
            ChatPanel.instance = undefined;
        });
    }

    // ── Singleton factory ─────────────────────────

    static create(
        orchestrator: AgentOrchestrator,
        memory: AgentMemory,
        providerRegistry: ProviderRegistry,
        context: vscode.ExtensionContext
    ): ChatPanel {
        if (ChatPanel.instance && !ChatPanel.instance.isDisposed) {
            ChatPanel.instance.panel.reveal(vscode.ViewColumn.Beside);
            return ChatPanel.instance;
        }
        ChatPanel.instance = new ChatPanel(orchestrator, memory, providerRegistry, context);
        return ChatPanel.instance;
    }

    // ── Load webview files from disk ──────────────

    private loadWebview(): string {
        const webviewPath = path.join(this.context.extensionPath, 'webview');
        const fs = require('fs');

        // Read the three source files
        const html = fs.readFileSync(path.join(webviewPath, 'chat.html'), 'utf8');
        const css = fs.readFileSync(path.join(webviewPath, 'chat.css'), 'utf8');
        const js = fs.readFileSync(path.join(webviewPath, 'chat.js'), 'utf8');

        // Inline CSS and JS into the HTML so the webview
        // does not need external file URIs
        return html
            .replace('/*INJECT_CSS*/', css)
            .replace('/*INJECT_JS*/', js);
    }

    // ── Message handlers ──────────────────────────

    private registerMessageHandlers(): void {
        this.panel.webview.onDidReceiveMessage(async msg => {
            switch (msg.command) {
                case 'sendMessage': await this.handleChatMessage(msg.text); break;
                case 'clearChat': await this.handleClearChat(); break;
                case 'getMemoryStats': this.sendMemoryStats(); break;
                case 'getAgentStats': this.sendAgentStats(); break;
                case 'applyCode': await this.applyCodeToEditor(msg.code); break;
                case 'copyCode': await vscode.env.clipboard.writeText(msg.code); break;
                case 'runTool': await this.handleToolRun(msg.tool, msg.params); break;
                case 'openProviderSelector': ProviderSelectorPanel.create(this.providerRegistry, this.context); break;
            }
        });
    }

    private async handleChatMessage(text: string): Promise<void> {
        this.postToWebview({ command: 'showThinking' });

        try {
            const editor = vscode.window.activeTextEditor;
            const editorCtx = editor ? this.buildEditorContext(editor) : undefined;

            const providerID = this.providerRegistry.getProviderID();
            const providerMeta = this.providerRegistry.getMeta(providerID);

            const result = await this.orchestrator.chat(text, editorCtx);

            this.postToWebview({
                command: 'receiveMessage',
                message: {
                    role: 'assistant',
                    content: result.output,
                    agentUsed: result.agentUsed,
                    suggestions: result.suggestions ?? [],
                    codeChanges: result.codeChanges ?? [],
                    toolsUsed: result.toolsUsed ?? [],
                    metadata: result.metadata,
                    timestamp: Date.now(),
                },
            });

        } catch (error: any) {
            const providerID = this.providerRegistry.getProviderID();
            const providerMeta = this.providerRegistry.getMeta(providerID);
            let errorMsg = error.message || 'Unknown error';
            
            // Provide actionable errors
            if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('http') || errorMsg.includes('localhost')) {
                errorMsg = `Provider "${providerMeta.displayName}" is not running or unreachable.\n\n**Try:** Click 📍 Provider → switch to a different provider or start the service.`;
            }
            
            this.postToWebview({
                command: 'receiveMessage',
                message: {
                    role: 'assistant',
                    content: `⚠️ **Error:** ${errorMsg}`,
                    agentUsed: 'general',
                    timestamp: Date.now(),
                    isError: true,
                },
            });
        }
    }

    private async handleClearChat(): Promise<void> {
        await this.memory.clearAll();
        this.postToWebview({ command: 'chatCleared' });
    }

    private sendMemoryStats(): void {
        this.postToWebview({
            command: 'memoryStats',
            stats: this.memory.getStats(),
        });
    }

    private sendAgentStats(): void {
        this.postToWebview({
            command: 'agentStats',
            stats: this.orchestrator.getStats(),
        });
    }

    private async handleToolRun(
        tool: string,
        params: Record<string, unknown>
    ): Promise<void> {
        const registry = this.orchestrator.getRegistry();
        const result = await registry.execute(tool, params);
        this.postToWebview({ command: 'toolResult', tool, result });
    }

    private async applyCodeToEditor(code: string): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor to apply code to.');
            return;
        }

        const answer = await vscode.window.showInformationMessage(
            'Apply this code to the current editor?',
            'Yes', 'No'
        );
        if (answer !== 'Yes') { return; }

        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            editor.document.uri,
            new vscode.Range(
                editor.document.positionAt(0),
                editor.document.positionAt(editor.document.getText().length)
            ),
            code
        );
        await vscode.workspace.applyEdit(edit);
        vscode.window.showInformationMessage('✅ Code applied successfully!');
    }

    private buildEditorContext(editor: vscode.TextEditor): string {
        const selection = editor.selection;
        const code = selection.isEmpty
            ? editor.document.getText().slice(0, 3_000)
            : editor.document.getText(selection);

        return [
            `File: ${editor.document.fileName}`,
            `Language: ${editor.document.languageId}`,
            `Lines: ${editor.document.lineCount}`,
            '',
            'Code:',
            code,
        ].join('\n');
    }

    private postToWebview(message: unknown): void {
        if (!this.isDisposed) {
            this.panel.webview.postMessage(message);
        }
    }
}