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
exports.ProviderRegistry = exports.PROVIDER_CATALOGUE = void 0;
const vscode = __importStar(require("vscode"));
const OpenAIProvider_1 = require("./OpenAIProvider");
const AnthropicProvider_1 = require("./AnthropicProvider");
const OllamaProvider_1 = require("./OllamaProvider");
const ClineProvider_1 = require("./ClineProvider");
const AiderProvider_1 = require("./AiderProvider");
const CortexProvider_1 = require("./CortexProvider");
const LocalLLMProvider_1 = require("./LocalLLMProvider");
// ─────────────────────────────────────────────
//  Provider catalogue — all 6 open-source solutions
//  plus OpenAI and Anthropic
// ─────────────────────────────────────────────
exports.PROVIDER_CATALOGUE = [
    {
        id: 'ollama',
        displayName: 'Ollama',
        description: 'Easiest local setup — no API key, full privacy',
        icon: '🦙',
        requiresKey: false,
        isLocal: true,
        setupUrl: 'https://ollama.com/download',
        models: ['llama3.2', 'codellama', 'deepseek-coder', 'qwen2.5-coder', 'mistral'],
        strength: 'Easiest setup · Full features · No cost',
    },
    {
        id: 'cline',
        displayName: 'Cline',
        description: 'Most popular open-source agent with MCP tool support',
        icon: '🔧',
        requiresKey: false,
        isLocal: false,
        setupUrl: 'https://github.com/cline/cline',
        models: ['claude-3-5-sonnet-20241022', 'gpt-4o'],
        strength: 'Most popular · MCP tools · Advanced workflows',
    },
    {
        id: 'aider',
        displayName: 'Aider',
        description: 'Git-integrated AI coding with cost optimization',
        icon: '🔀',
        requiresKey: false,
        isLocal: false,
        setupUrl: 'https://aider.chat/docs/install.html',
        models: ['gpt-4o', 'claude-3-5-sonnet-20241022', 'deepseek/deepseek-coder'],
        strength: 'Git integration · Cost optimization · Terminal workflows',
    },
    {
        id: 'cortex',
        displayName: 'CortexIDE',
        description: 'Complete privacy-first IDE — local Cursor alternative',
        icon: '🧠',
        requiresKey: false,
        isLocal: true,
        setupUrl: 'https://cortex.so/docs',
        models: ['cortexso/llama3.2', 'cortexso/codestral', 'cortexso/mistral'],
        strength: 'Privacy-first · Complete IDE replacement · No telemetry',
    },
    {
        id: 'localllm',
        displayName: 'Local LLM Copilot',
        description: 'Fast completions via LM Studio, llama.cpp, or Jan',
        icon: '💻',
        requiresKey: false,
        isLocal: true,
        setupUrl: 'https://lmstudio.ai',
        models: ['local-model', 'codellama-7b', 'deepseek-coder-6.7b'],
        strength: 'Fastest completions · Lightweight · Zero cost',
    },
    {
        id: 'openai',
        displayName: 'OpenAI',
        description: 'GPT-4o and GPT-4 — highest quality cloud AI',
        icon: '✨',
        requiresKey: true,
        isLocal: false,
        setupUrl: 'https://platform.openai.com/api-keys',
        models: ['gpt-4o', 'gpt-4', 'gpt-3.5-turbo'],
        strength: 'Highest quality · Best reasoning · Widely tested',
    },
    {
        id: 'anthropic',
        displayName: 'Anthropic Claude',
        description: 'Claude 3.5 Sonnet — excellent for long context',
        icon: '🌟',
        requiresKey: true,
        isLocal: false,
        setupUrl: 'https://console.anthropic.com',
        models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'],
        strength: 'Long context · Nuanced analysis · Safety-focused',
    },
    {
        id: 'mock',
        displayName: 'Demo Mode',
        description: 'Test the full UI without any API key or local server',
        icon: '🎮',
        requiresKey: false,
        isLocal: true,
        models: ['mock-v1'],
        strength: 'Zero setup · UI testing · No cost',
    },
];
// ─────────────────────────────────────────────
//  ProviderRegistry
// ─────────────────────────────────────────────
class ProviderRegistry {
    constructor(context, initialProvider, initialID) {
        this.context = context;
        this.listeners = [];
        this.activeProvider = initialProvider;
        this.activeProviderID = initialID;
    }
    // ── Active provider ───────────────────────────
    getProvider() { return this.activeProvider; }
    getProviderID() { return this.activeProviderID; }
    getMeta() {
        return exports.PROVIDER_CATALOGUE.find(p => p.id === this.activeProviderID)
            ?? exports.PROVIDER_CATALOGUE[exports.PROVIDER_CATALOGUE.length - 1];
    }
    // ── Switching ─────────────────────────────────
    async switchProvider(id) {
        const provider = await this.build(id);
        this.activeProvider = provider;
        this.activeProviderID = id;
        // Persist the choice
        await this.context.globalState.update('aiAgent.activeProvider', id);
        // Notify listeners (status bar, chat panel, etc.)
        this.listeners.forEach(fn => fn(id, provider));
        return provider;
    }
    onProviderChange(fn) {
        this.listeners.push(fn);
    }
    // ── Factory ───────────────────────────────────
    async build(id) {
        const config = vscode.workspace.getConfiguration('aiAgent');
        switch (id) {
            // ── OpenAI ────────────────────────────────────
            case 'openai': {
                const key = config.get('openaiApiKey') ?? '';
                const model = config.get('model') ?? 'gpt-4o';
                if (!key) {
                    this.promptForKey('openai');
                }
                return new OpenAIProvider_1.OpenAIProvider(key, model);
            }
            // ── Anthropic ─────────────────────────────────
            case 'anthropic': {
                const key = config.get('anthropicApiKey') ?? '';
                const model = config.get('model') ?? 'claude-3-5-sonnet-20241022';
                if (!key) {
                    this.promptForKey('anthropic');
                }
                return new AnthropicProvider_1.AnthropicProvider(key, model);
            }
            // ── Ollama ────────────────────────────────────
            case 'ollama': {
                const provider = new OllamaProvider_1.OllamaProvider({
                    baseUrl: config.get('ollama.baseUrl') ?? 'http://localhost:11434',
                    model: config.get('ollama.model') ?? 'llama3.2',
                });
                const available = await provider.isAvailable();
                if (!available) {
                    vscode.window.showWarningMessage('🦙 Ollama is not running. Install it from ollama.com then run: ollama serve', 'Open Download Page').then(btn => {
                        if (btn) {
                            vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/download'));
                        }
                    });
                }
                return provider;
            }
            // ── Cline ─────────────────────────────────────
            case 'cline': {
                // Cline delegates to the currently configured cloud provider
                const delegateID = config.get('cline.delegateProvider') ?? 'openai';
                const delegate = await this.build(delegateID);
                // Load MCP servers from config
                const mcpServers = config.get('cline.mcpServers') ?? {};
                return new ClineProvider_1.ClineProvider({
                    delegateProvider: delegate,
                    mcpServers,
                    useClineExtension: config.get('cline.useExtension') ?? true,
                });
            }
            // ── Aider ─────────────────────────────────────
            case 'aider': {
                const delegateID = config.get('aider.delegateProvider') ?? 'openai';
                const delegate = await this.build(delegateID);
                return new AiderProvider_1.AiderProvider({
                    delegateProvider: delegate,
                    aiderPath: config.get('aider.path') ?? 'aider',
                    autoCommits: config.get('aider.autoCommits') ?? true,
                    showCostEstimate: config.get('aider.showCost') ?? true,
                });
            }
            // ── CortexIDE ─────────────────────────────────
            case 'cortex': {
                const provider = new CortexProvider_1.CortexProvider({
                    baseUrl: config.get('cortex.baseUrl') ?? 'http://localhost:39281',
                    model: config.get('cortex.model') ?? 'cortexso/llama3.2',
                });
                const available = await provider.isAvailable();
                if (!available) {
                    vscode.window.showWarningMessage('🧠 CortexIDE server is not running. Start it with: cortex start', 'Open Docs').then(btn => {
                        if (btn) {
                            vscode.env.openExternal(vscode.Uri.parse('https://cortex.so/docs'));
                        }
                    });
                }
                return provider;
            }
            // ── Local LLM ─────────────────────────────────
            case 'localllm': {
                const backend = config.get('localllm.backend') ?? 'lmstudio';
                const provider = new LocalLLMProvider_1.LocalLLMProvider({
                    backend: backend,
                    baseUrl: config.get('localllm.baseUrl'),
                    model: config.get('localllm.model') ?? 'local-model',
                    contextSize: config.get('localllm.contextSize') ?? 4096,
                });
                const available = await provider.isAvailable();
                if (!available) {
                    vscode.window.showWarningMessage(`💻 Local LLM server (${backend}) is not running.`, 'Open LM Studio').then(btn => {
                        if (btn) {
                            vscode.env.openExternal(vscode.Uri.parse('https://lmstudio.ai'));
                        }
                    });
                }
                return provider;
            }
            // ── Mock ──────────────────────────────────────
            case 'mock':
            default:
                return this.buildMock();
        }
    }
    // ── Restore last used provider on startup ─────
    async restoreProvider() {
        const saved = this.context.globalState.get('aiAgent.activeProvider');
        if (saved && saved !== this.activeProviderID) {
            try {
                await this.switchProvider(saved);
            }
            catch {
                // If restore fails fall back to current provider silently
            }
        }
    }
    // ── Helpers ───────────────────────────────────
    promptForKey(provider) {
        const labels = {
            openai: 'OpenAI API key (platform.openai.com/api-keys)',
            anthropic: 'Anthropic API key (console.anthropic.com)',
        };
        vscode.window.showWarningMessage(`⚠️ No ${labels[provider]} configured.`, 'Open Settings').then(btn => {
            if (btn) {
                vscode.commands.executeCommand('workbench.action.openSettings', `aiAgent.${provider}ApiKey`);
            }
        });
    }
    buildMock() {
        // Inline mock so ProviderRegistry has no circular dep on extension.ts
        return {
            name: 'mock',
            async complete(req) {
                await new Promise(r => setTimeout(r, 500));
                const p = req.userMessage.toLowerCase();
                let content = '🎮 **Demo mode** — add a provider in settings for real AI.\n\n';
                if (p.includes('test')) {
                    content += '```js\nit("works", () => expect(true).toBe(true));\n```';
                }
                else if (p.includes('bug')) {
                    content += 'Found: missing null-check on line 7.';
                }
                else if (p.includes('[]') || p.includes('json')) {
                    content = '[]';
                }
                else {
                    content += 'I can analyze, debug, refactor, and generate tests.';
                }
                return { content, model: 'mock-v1' };
            },
            async ask(prompt) { return (await this.complete({ systemPrompt: '', userMessage: prompt })).content; },
        };
    }
}
exports.ProviderRegistry = ProviderRegistry;
//# sourceMappingURL=ProviderRegistry.js.map