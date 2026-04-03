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
exports.ChatPanel = void 0;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
class ChatPanel {
    constructor(orchestrator, memory, context) {
        this.orchestrator = orchestrator;
        this.memory = memory;
        this.context = context;
        this.isDisposed = false;
        this.panel = vscode.window.createWebviewPanel('aiAgentChat', '🤖 AI Agent Chat', vscode.ViewColumn.Beside, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(context.extensionPath, 'webview')),
            ],
        });
        this.panel.webview.html = this.loadWebview();
        this.registerMessageHandlers();
        this.panel.onDidDispose(() => {
            this.isDisposed = true;
            ChatPanel.instance = undefined;
        });
    }
    // ── Singleton factory ─────────────────────────
    static create(orchestrator, memory, context) {
        if (ChatPanel.instance && !ChatPanel.instance.isDisposed) {
            ChatPanel.instance.panel.reveal(vscode.ViewColumn.Beside);
            return ChatPanel.instance;
        }
        ChatPanel.instance = new ChatPanel(orchestrator, memory, context);
        return ChatPanel.instance;
    }
    // ── Load webview files from disk ──────────────
    loadWebview() {
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
    registerMessageHandlers() {
        this.panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.command) {
                case 'sendMessage':
                    await this.handleChatMessage(msg.text);
                    break;
                case 'clearChat':
                    await this.handleClearChat();
                    break;
                case 'getMemoryStats':
                    this.sendMemoryStats();
                    break;
                case 'getAgentStats':
                    this.sendAgentStats();
                    break;
                case 'applyCode':
                    await this.applyCodeToEditor(msg.code);
                    break;
                case 'copyCode':
                    await vscode.env.clipboard.writeText(msg.code);
                    break;
                case 'runTool':
                    await this.handleToolRun(msg.tool, msg.params);
                    break;
            }
        });
    }
    async handleChatMessage(text) {
        this.postToWebview({ command: 'showThinking' });
        try {
            const editor = vscode.window.activeTextEditor;
            const editorCtx = editor ? this.buildEditorContext(editor) : undefined;
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
        }
        catch (error) {
            this.postToWebview({
                command: 'receiveMessage',
                message: {
                    role: 'assistant',
                    content: `⚠️ **Error:** ${error.message}`,
                    agentUsed: 'general',
                    timestamp: Date.now(),
                    isError: true,
                },
            });
        }
    }
    async handleClearChat() {
        await this.memory.clearAll();
        this.postToWebview({ command: 'chatCleared' });
    }
    sendMemoryStats() {
        this.postToWebview({
            command: 'memoryStats',
            stats: this.memory.getStats(),
        });
    }
    sendAgentStats() {
        this.postToWebview({
            command: 'agentStats',
            stats: this.orchestrator.getStats(),
        });
    }
    async handleToolRun(tool, params) {
        const registry = this.orchestrator.getRegistry();
        const result = await registry.execute(tool, params);
        this.postToWebview({ command: 'toolResult', tool, result });
    }
    async applyCodeToEditor(code) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor to apply code to.');
            return;
        }
        const answer = await vscode.window.showInformationMessage('Apply this code to the current editor?', 'Yes', 'No');
        if (answer !== 'Yes') {
            return;
        }
        const edit = new vscode.WorkspaceEdit();
        edit.replace(editor.document.uri, new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length)), code);
        await vscode.workspace.applyEdit(edit);
        vscode.window.showInformationMessage('✅ Code applied successfully!');
    }
    buildEditorContext(editor) {
        const selection = editor.selection;
        const code = selection.isEmpty
            ? editor.document.getText().slice(0, 3000)
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
    postToWebview(message) {
        if (!this.isDisposed) {
            this.panel.webview.postMessage(message);
        }
    }
}
exports.ChatPanel = ChatPanel;
//# sourceMappingURL=ChatPanel.js.map