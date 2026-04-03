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
exports.ProviderRegistry = void 0;
exports.buildCatalogue = buildCatalogue;
const vscode = __importStar(require("vscode"));
const cp = __importStar(require("child_process"));
const util = __importStar(require("util"));
const OpenAIProvider_1 = require("./OpenAIProvider");
const AnthropicProvider_1 = require("./AnthropicProvider");
const OllamaProvider_1 = require("./OllamaProvider");
const ClineProvider_1 = require("./ClineProvider");
const AiderProvider_1 = require("./AiderProvider");
const CortexProvider_1 = require("./CortexProvider");
const LocalLLMProvider_1 = require("./LocalLLMProvider");
const exec = util.promisify(cp.exec);
// ─────────────────────────────────────────────
//  Provider catalogue
// ─────────────────────────────────────────────
function buildCatalogue() {
    return [
        {
            id: 'ollama',
            displayName: 'Ollama',
            description: 'Run LLMs locally — no API key, full privacy',
            icon: '🦙',
            requiresKey: false,
            isLocal: true,
            setupUrl: 'https://ollama.com/download',
            installCmd: process.platform === 'darwin'
                ? 'brew install ollama'
                : 'curl -fsSL https://ollama.com/install.sh | sh',
            startCmd: 'ollama serve',
            models: ['llama3.2', 'codellama', 'deepseek-coder', 'qwen2.5-coder', 'mistral'],
            strength: 'Easiest setup · Full features · No cost',
            status: 'unknown',
        },
        {
            id: 'localllm',
            displayName: 'LM Studio',
            description: 'Fast completions via LM Studio desktop app',
            icon: '💻',
            requiresKey: false,
            isLocal: true,
            setupUrl: 'https://lmstudio.ai',
            startCmd: 'open -a "LM Studio"',
            models: ['local-model'],
            strength: 'Fastest completions · Desktop app · Zero cost',
            status: 'unknown',
        },
        {
            id: 'cortex',
            displayName: 'CortexIDE',
            description: 'Privacy-first local LLM — Cursor alternative',
            icon: '🧠',
            requiresKey: false,
            isLocal: true,
            setupUrl: 'https://cortex.so/docs',
            installCmd: 'npm install -g @janhq/cortexso',
            startCmd: 'cortex start',
            models: ['cortexso/llama3.2', 'cortexso/mistral'],
            strength: 'Privacy-first · No telemetry · Local',
            status: 'unknown',
        },
        {
            id: 'cline',
            displayName: 'Cline',
            description: 'Most popular open-source agent with MCP tools',
            icon: '🔧',
            requiresKey: false,
            isLocal: false,
            setupUrl: 'https://github.com/cline/cline',
            installCmd: 'code --install-extension saoudrizwan.claude-dev',
            models: ['claude-3-5-sonnet-20241022', 'gpt-4o'],
            strength: 'Most popular · MCP tools · Advanced workflows',
            status: 'unknown',
        },
        {
            id: 'aider',
            displayName: 'Aider',
            description: 'Git-integrated AI coding with cost optimization',
            icon: '🔀',
            requiresKey: false,
            isLocal: false,
            setupUrl: 'https://aider.chat/docs/install.html',
            installCmd: 'pip install aider-chat',
            models: ['gpt-4o', 'claude-3-5-sonnet-20241022'],
            strength: 'Git integration · Cost optimization · Terminal',
            status: 'unknown',
        },
        {
            id: 'openai',
            displayName: 'OpenAI',
            description: 'GPT-4o — highest quality cloud AI',
            icon: '✨',
            requiresKey: true,
            isLocal: false,
            setupUrl: 'https://platform.openai.com/api-keys',
            models: ['gpt-4o', 'gpt-4', 'gpt-3.5-turbo'],
            strength: 'Highest quality · Best reasoning · Widely tested',
            status: 'unknown',
        },
        {
            id: 'anthropic',
            displayName: 'Anthropic Claude',
            description: 'Claude 3.5 Sonnet — excellent long context',
            icon: '🌟',
            requiresKey: true,
            isLocal: false,
            setupUrl: 'https://console.anthropic.com',
            models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'],
            strength: 'Long context · Nuanced analysis · Safety-focused',
            status: 'unknown',
        },
        {
            id: 'mock',
            displayName: 'Demo Mode',
            description: 'Test the full UI — no setup needed',
            icon: '🎮',
            requiresKey: false,
            isLocal: true,
            setupUrl: '',
            models: ['mock-v1'],
            strength: 'Zero setup · UI testing · Always works',
            status: 'ready',
        },
    ];
}
// ─────────────────────────────────────────────
//  ProviderRegistry
// ─────────────────────────────────────────────
class ProviderRegistry {
    constructor(context, initialProvider, initialID) {
        this.context = context;
        this.listeners = [];
        this.installListeners = [];
        this.activeProvider = initialProvider;
        this.activeProviderID = initialID;
        this.catalogue = buildCatalogue();
    }
    // ── Getters ───────────────────────────────────
    getProvider() { return this.activeProvider; }
    getProviderID() { return this.activeProviderID; }
    getCatalogue() { return this.catalogue; }
    getMeta(id) {
        return this.catalogue.find(p => p.id === (id ?? this.activeProviderID))
            ?? this.catalogue[this.catalogue.length - 1];
    }
    // ── Status detection ──────────────────────────
    /**
     * Check every provider's status in parallel.
     * Updates the catalogue in-place so the UI can show
     * green/red indicators without blocking.
     */
    async detectAllStatuses() {
        await Promise.all(this.catalogue.map(meta => this.detectStatus(meta)));
    }
    async detectStatus(meta) {
        meta.status = 'checking';
        try {
            let status = 'unknown';
            switch (meta.id) {
                case 'ollama': {
                    const installed = await this.commandExists('ollama');
                    if (!installed) {
                        status = 'not-installed';
                        break;
                    }
                    const running = await this.portOpen('localhost', 11434);
                    status = running ? 'ready' : 'not-running';
                    break;
                }
                case 'cortex': {
                    const installed = await this.commandExists('cortex');
                    if (!installed) {
                        status = 'not-installed';
                        break;
                    }
                    const running = await this.portOpen('localhost', 39281);
                    status = running ? 'ready' : 'not-running';
                    break;
                }
                case 'localllm': {
                    // LM Studio listens on 1234 by default
                    const running = await this.portOpen('localhost', 1234);
                    status = running ? 'ready' : 'not-running';
                    break;
                }
                case 'aider': {
                    const installed = await this.commandExists('aider');
                    status = installed ? 'ready' : 'not-installed';
                    break;
                }
                case 'cline': {
                    const ext = vscode.extensions.getExtension('saoudrizwan.claude-dev');
                    status = ext ? 'ready' : 'not-installed';
                    break;
                }
                case 'openai': {
                    const config = vscode.workspace.getConfiguration('aiAgent');
                    const key = config.get('openaiApiKey') ?? '';
                    status = key.length > 10 ? 'ready' : 'needs-key';
                    break;
                }
                case 'anthropic': {
                    const config = vscode.workspace.getConfiguration('aiAgent');
                    const key = config.get('anthropicApiKey') ?? '';
                    status = key.length > 10 ? 'ready' : 'needs-key';
                    break;
                }
                case 'mock':
                    status = 'ready';
                    break;
            }
            meta.status = status;
            return status;
        }
        catch {
            meta.status = 'unknown';
            return 'unknown';
        }
    }
    // ── Auto-install ──────────────────────────────
    /**
     * Attempt to install a provider automatically.
     * Opens a terminal and runs the install command, then polls for completion.
     * Emits progress updates via onInstallProgress listeners.
     */
    async autoInstall(id) {
        const meta = this.getMeta(id);
        if (!meta.installCmd) {
            return false;
        }
        const terminal = vscode.window.createTerminal({
            name: `Install ${meta.displayName}`,
        });
        terminal.show();
        terminal.sendText(meta.installCmd + '; echo "INSTALL_COMPLETE"');
        // Emit 'installing' status immediately
        this.emitInstallProgress(id, 'installing');
        // For Ollama on Mac, also offer brew cask
        if (id === 'ollama' && process.platform === 'darwin') {
            const answer = await vscode.window.showInformationMessage('🦙 Installing Ollama via Homebrew. If brew is not installed, download from ollama.com instead.', 'Open Download Page', 'Continue with brew');
            if (answer === 'Open Download Page') {
                vscode.env.openExternal(vscode.Uri.parse(meta.setupUrl));
                return false;
            }
        }
        // Poll for completion by checking if command now exists
        // Wait up to 10 minutes for install to complete
        const maxAttempts = 120; // 120 * 5 seconds = 10 minutes
        for (let i = 0; i < maxAttempts; i++) {
            await new Promise(r => setTimeout(r, 5000)); // Check every 5 seconds
            // Emit 'checking' status after a few seconds
            if (i === 2) {
                this.emitInstallProgress(id, 'checking');
            }
            const prevStatus = meta.status;
            await this.detectStatus(meta);
            // If status changed to ready, install succeeded
            if (meta.status === 'ready' && prevStatus !== 'ready') {
                this.emitInstallProgress(id, 'ready');
                vscode.window.showInformationMessage(`✅ ${meta.displayName} installed successfully! Ready to use.`);
                return true;
            }
            // If 'not-running', installation likely succeeded but server not started
            if (meta.status === 'not-running' && i > 20) {
                this.emitInstallProgress(id, 'ready');
                vscode.window.showInformationMessage(`✅ ${meta.displayName} installed! You can now start the server.`);
                return true;
            }
        }
        // Timeout after 10 minutes
        this.emitInstallProgress(id, 'failed');
        vscode.window.showWarningMessage(`⏱️ Installation timeout. Please check the terminal for errors.`);
        return false;
    }
    /**
     * Start a local provider's server in a terminal.
     */
    async autoStart(id) {
        const meta = this.getMeta(id);
        if (!meta.startCmd) {
            return;
        }
        const terminal = vscode.window.createTerminal({
            name: `${meta.icon} ${meta.displayName}`,
        });
        terminal.show();
        terminal.sendText(meta.startCmd);
        // Wait 3 seconds then re-check status
        await new Promise(r => setTimeout(r, 3000));
        await this.detectStatus(meta);
    }
    // ── Switching ─────────────────────────────────
    async switchProvider(id) {
        const meta = this.getMeta(id);
        const provider = await this.build(id);
        this.activeProvider = provider;
        this.activeProviderID = id;
        await this.context.globalState.update('aiAgent.activeProvider', id);
        this.listeners.forEach(fn => fn(id, provider));
        return provider;
    }
    onProviderChange(fn) {
        this.listeners.push(fn);
    }
    onInstallProgress(fn) {
        this.installListeners.push(fn);
    }
    emitInstallProgress(id, status) {
        this.installListeners.forEach(fn => fn(id, status));
    }
    async restoreProvider() {
        const saved = this.context.globalState.get('aiAgent.activeProvider');
        if (saved && saved !== this.activeProviderID) {
            await this.switchProvider(saved).catch(() => { });
        }
    }
    // ── Factory ───────────────────────────────────
    async build(id) {
        const config = vscode.workspace.getConfiguration('aiAgent');
        switch (id) {
            case 'openai': {
                const key = config.get('openaiApiKey') ?? '';
                const model = config.get('model') ?? 'gpt-4o';
                return new OpenAIProvider_1.OpenAIProvider(key, model);
            }
            case 'anthropic': {
                const key = config.get('anthropicApiKey') ?? '';
                const model = config.get('model') ?? 'claude-3-5-sonnet-20241022';
                return new AnthropicProvider_1.AnthropicProvider(key, model);
            }
            case 'ollama': {
                return new OllamaProvider_1.OllamaProvider({
                    baseUrl: config.get('ollama.baseUrl') ?? 'http://localhost:11434',
                    model: config.get('ollama.model') ?? 'llama3.2',
                });
            }
            case 'cline': {
                const delegateID = config.get('cline.delegateProvider') ?? 'openai';
                const delegate = await this.build(delegateID);
                const mcpServers = config.get('cline.mcpServers') ?? {};
                return new ClineProvider_1.ClineProvider({
                    delegateProvider: delegate,
                    mcpServers,
                    useClineExtension: config.get('cline.useExtension') ?? true,
                });
            }
            case 'aider': {
                const delegateID = config.get('aider.delegateProvider') ?? 'openai';
                const delegate = await this.build(delegateID);
                return new AiderProvider_1.AiderProvider({
                    delegateProvider: delegate,
                    aiderPath: config.get('aider.path') ?? 'aider',
                    autoCommits: config.get('aider.autoCommits') ?? true,
                });
            }
            case 'cortex': {
                return new CortexProvider_1.CortexProvider({
                    baseUrl: config.get('cortex.baseUrl') ?? 'http://localhost:39281',
                    model: config.get('cortex.model') ?? 'cortexso/llama3.2',
                });
            }
            case 'localllm': {
                return new LocalLLMProvider_1.LocalLLMProvider({
                    backend: (config.get('localllm.backend') ?? 'lmstudio'),
                    baseUrl: config.get('localllm.baseUrl'),
                    model: config.get('localllm.model') ?? 'local-model',
                    contextSize: config.get('localllm.contextSize') ?? 4096,
                });
            }
            case 'mock':
            default:
                return this.buildMock();
        }
    }
    // ── Utility helpers ───────────────────────────
    async commandExists(cmd) {
        try {
            const which = process.platform === 'win32' ? 'where' : 'which';
            await exec(`${which} ${cmd}`);
            return true;
        }
        catch {
            return false;
        }
    }
    portOpen(host, port) {
        return new Promise(resolve => {
            const net = require('net');
            const socket = new net.Socket();
            const timer = setTimeout(() => {
                socket.destroy();
                resolve(false);
            }, 2000);
            socket.connect(port, host, () => {
                clearTimeout(timer);
                socket.destroy();
                resolve(true);
            });
            socket.on('error', () => {
                clearTimeout(timer);
                resolve(false);
            });
        });
    }
    buildMock() {
        return {
            name: 'mock',
            async complete(req) {
                await new Promise(r => setTimeout(r, 500));
                const p = req.userMessage.toLowerCase();
                let content = '🎮 **Demo mode** — add a provider to get real AI responses.\n\n';
                if (p.includes('test')) {
                    content += '```js\nit("works", () => expect(true).toBe(true));\n```';
                }
                else if (p.includes('bug')) {
                    content += 'Found: missing null-check on line 7.';
                }
                else {
                    content += 'I can analyze, debug, refactor, and generate tests.';
                }
                return { content, model: 'mock-v1' };
            },
            async ask(prompt) {
                return (await this.complete({ systemPrompt: '', userMessage: prompt })).content;
            },
        };
    }
}
exports.ProviderRegistry = ProviderRegistry;
//# sourceMappingURL=ProviderRegistry.js.map