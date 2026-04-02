import * as vscode            from 'vscode';
import { AIProvider }         from './AIProvider';
import { OpenAIProvider }     from './OpenAIProvider';
import { AnthropicProvider }  from './AnthropicProvider';
import { OllamaProvider }     from './OllamaProvider';
import { ClineProvider }      from './ClineProvider';
import { AiderProvider }      from './AiderProvider';
import { CortexProvider }     from './CortexProvider';
import { LocalLLMProvider }   from './LocalLLMProvider';

// ─────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────

export type ProviderID =
  | 'openai'
  | 'anthropic'
  | 'ollama'
  | 'cline'
  | 'aider'
  | 'cortex'
  | 'localllm'
  | 'mock';

export interface ProviderMeta {
  id:           ProviderID;
  displayName:  string;
  description:  string;
  icon:         string;
  requiresKey:  boolean;
  isLocal:      boolean;      // true = no internet required
  setupUrl?:    string;       // installation / download link
  models:       string[];     // suggested models
  strength:     string;       // one-line summary of best use
}

// ─────────────────────────────────────────────
//  Provider catalogue — all 6 open-source solutions
//  plus OpenAI and Anthropic
// ─────────────────────────────────────────────

export const PROVIDER_CATALOGUE: ProviderMeta[] = [
  {
    id:          'ollama',
    displayName: 'Ollama',
    description: 'Easiest local setup — no API key, full privacy',
    icon:        '🦙',
    requiresKey: false,
    isLocal:     true,
    setupUrl:    'https://ollama.com/download',
    models:      ['llama3.2', 'codellama', 'deepseek-coder', 'qwen2.5-coder', 'mistral'],
    strength:    'Easiest setup · Full features · No cost',
  },
  {
    id:          'cline',
    displayName: 'Cline',
    description: 'Most popular open-source agent with MCP tool support',
    icon:        '🔧',
    requiresKey: false,
    isLocal:     false,
    setupUrl:    'https://github.com/cline/cline',
    models:      ['claude-3-5-sonnet-20241022', 'gpt-4o'],
    strength:    'Most popular · MCP tools · Advanced workflows',
  },
  {
    id:          'aider',
    displayName: 'Aider',
    description: 'Git-integrated AI coding with cost optimization',
    icon:        '🔀',
    requiresKey: false,
    isLocal:     false,
    setupUrl:    'https://aider.chat/docs/install.html',
    models:      ['gpt-4o', 'claude-3-5-sonnet-20241022', 'deepseek/deepseek-coder'],
    strength:    'Git integration · Cost optimization · Terminal workflows',
  },
  {
    id:          'cortex',
    displayName: 'CortexIDE',
    description: 'Complete privacy-first IDE — local Cursor alternative',
    icon:        '🧠',
    requiresKey: false,
    isLocal:     true,
    setupUrl:    'https://cortex.so/docs',
    models:      ['cortexso/llama3.2', 'cortexso/codestral', 'cortexso/mistral'],
    strength:    'Privacy-first · Complete IDE replacement · No telemetry',
  },
  {
    id:          'localllm',
    displayName: 'Local LLM Copilot',
    description: 'Fast completions via LM Studio, llama.cpp, or Jan',
    icon:        '💻',
    requiresKey: false,
    isLocal:     true,
    setupUrl:    'https://lmstudio.ai',
    models:      ['local-model', 'codellama-7b', 'deepseek-coder-6.7b'],
    strength:    'Fastest completions · Lightweight · Zero cost',
  },
  {
    id:          'openai',
    displayName: 'OpenAI',
    description: 'GPT-4o and GPT-4 — highest quality cloud AI',
    icon:        '✨',
    requiresKey: true,
    isLocal:     false,
    setupUrl:    'https://platform.openai.com/api-keys',
    models:      ['gpt-4o', 'gpt-4', 'gpt-3.5-turbo'],
    strength:    'Highest quality · Best reasoning · Widely tested',
  },
  {
    id:          'anthropic',
    displayName: 'Anthropic Claude',
    description: 'Claude 3.5 Sonnet — excellent for long context',
    icon:        '🌟',
    requiresKey: true,
    isLocal:     false,
    setupUrl:    'https://console.anthropic.com',
    models:      ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'],
    strength:    'Long context · Nuanced analysis · Safety-focused',
  },
  {
    id:          'mock',
    displayName: 'Demo Mode',
    description: 'Test the full UI without any API key or local server',
    icon:        '🎮',
    requiresKey: false,
    isLocal:     true,
    models:      ['mock-v1'],
    strength:    'Zero setup · UI testing · No cost',
  },
];

// ─────────────────────────────────────────────
//  ProviderRegistry
// ─────────────────────────────────────────────

export class ProviderRegistry {
  private activeProvider:   AIProvider;
  private activeProviderID: ProviderID;
  private readonly listeners: Array<(id: ProviderID, p: AIProvider) => void> = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    initialProvider: AIProvider,
    initialID:       ProviderID
  ) {
    this.activeProvider   = initialProvider;
    this.activeProviderID = initialID;
  }

  // ── Active provider ───────────────────────────

  getProvider(): AIProvider { return this.activeProvider; }
  getProviderID(): ProviderID { return this.activeProviderID; }

  getMeta(): ProviderMeta {
    return PROVIDER_CATALOGUE.find(p => p.id === this.activeProviderID)
      ?? PROVIDER_CATALOGUE[PROVIDER_CATALOGUE.length - 1];
  }

  // ── Switching ─────────────────────────────────

  async switchProvider(id: ProviderID): Promise<AIProvider> {
    const provider = await this.build(id);
    this.activeProvider   = provider;
    this.activeProviderID = id;

    // Persist the choice
    await this.context.globalState.update('aiAgent.activeProvider', id);

    // Notify listeners (status bar, chat panel, etc.)
    this.listeners.forEach(fn => fn(id, provider));

    return provider;
  }

  onProviderChange(fn: (id: ProviderID, provider: AIProvider) => void): void {
    this.listeners.push(fn);
  }

  // ── Factory ───────────────────────────────────

  async build(id: ProviderID): Promise<AIProvider> {
    const config = vscode.workspace.getConfiguration('aiAgent');

    switch (id) {
      // ── OpenAI ────────────────────────────────────
      case 'openai': {
        const key   = config.get<string>('openaiApiKey') ?? '';
        const model = config.get<string>('model') ?? 'gpt-4o';
        if (!key) { this.promptForKey('openai'); }
        return new OpenAIProvider(key, model);
      }

      // ── Anthropic ─────────────────────────────────
      case 'anthropic': {
        const key   = config.get<string>('anthropicApiKey') ?? '';
        const model = config.get<string>('model') ?? 'claude-3-5-sonnet-20241022';
        if (!key) { this.promptForKey('anthropic'); }
        return new AnthropicProvider(key, model);
      }

      // ── Ollama ────────────────────────────────────
      case 'ollama': {
        const provider = new OllamaProvider({
          baseUrl: config.get<string>('ollama.baseUrl') ?? 'http://localhost:11434',
          model:   config.get<string>('ollama.model')   ?? 'llama3.2',
        });
        const available = await provider.isAvailable();
        if (!available) {
          vscode.window.showWarningMessage(
            '🦙 Ollama is not running. Install it from ollama.com then run: ollama serve',
            'Open Download Page'
          ).then(btn => {
            if (btn) { vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/download')); }
          });
        }
        return provider;
      }

      // ── Cline ─────────────────────────────────────
      case 'cline': {
        // Cline delegates to the currently configured cloud provider
        const delegateID = config.get<string>('cline.delegateProvider') ?? 'openai';
        const delegate   = await this.build(delegateID as ProviderID);

        // Load MCP servers from config
        const mcpServers = config.get<Record<string, string>>('cline.mcpServers') ?? {};

        return new ClineProvider({
          delegateProvider:    delegate,
          mcpServers,
          useClineExtension:   config.get<boolean>('cline.useExtension') ?? true,
        });
      }

      // ── Aider ─────────────────────────────────────
      case 'aider': {
        const delegateID = config.get<string>('aider.delegateProvider') ?? 'openai';
        const delegate   = await this.build(delegateID as ProviderID);

        return new AiderProvider({
          delegateProvider: delegate,
          aiderPath:        config.get<string>('aider.path')        ?? 'aider',
          autoCommits:      config.get<boolean>('aider.autoCommits') ?? true,
          showCostEstimate: config.get<boolean>('aider.showCost')    ?? true,
        });
      }

      // ── CortexIDE ─────────────────────────────────
      case 'cortex': {
        const provider = new CortexProvider({
          baseUrl: config.get<string>('cortex.baseUrl') ?? 'http://localhost:39281',
          model:   config.get<string>('cortex.model')   ?? 'cortexso/llama3.2',
        });
        const available = await provider.isAvailable();
        if (!available) {
          vscode.window.showWarningMessage(
            '🧠 CortexIDE server is not running. Start it with: cortex start',
            'Open Docs'
          ).then(btn => {
            if (btn) { vscode.env.openExternal(vscode.Uri.parse('https://cortex.so/docs')); }
          });
        }
        return provider;
      }

      // ── Local LLM ─────────────────────────────────
      case 'localllm': {
        const backend = config.get<string>('localllm.backend') ?? 'lmstudio';
        const provider = new LocalLLMProvider({
          backend:     backend as any,
          baseUrl:     config.get<string>('localllm.baseUrl'),
          model:       config.get<string>('localllm.model') ?? 'local-model',
          contextSize: config.get<number>('localllm.contextSize') ?? 4_096,
        });
        const available = await provider.isAvailable();
        if (!available) {
          vscode.window.showWarningMessage(
            `💻 Local LLM server (${backend}) is not running.`,
            'Open LM Studio'
          ).then(btn => {
            if (btn) { vscode.env.openExternal(vscode.Uri.parse('https://lmstudio.ai')); }
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

  async restoreProvider(): Promise<void> {
    const saved = this.context.globalState.get<ProviderID>('aiAgent.activeProvider');
    if (saved && saved !== this.activeProviderID) {
      try {
        await this.switchProvider(saved);
      } catch {
        // If restore fails fall back to current provider silently
      }
    }
  }

  // ── Helpers ───────────────────────────────────

  private promptForKey(provider: 'openai' | 'anthropic'): void {
    const labels: Record<string, string> = {
      openai:    'OpenAI API key (platform.openai.com/api-keys)',
      anthropic: 'Anthropic API key (console.anthropic.com)',
    };

    vscode.window.showWarningMessage(
      `⚠️ No ${labels[provider]} configured.`,
      'Open Settings'
    ).then(btn => {
      if (btn) {
        vscode.commands.executeCommand(
          'workbench.action.openSettings',
          `aiAgent.${provider}ApiKey`
        );
      }
    });
  }

  private buildMock(): AIProvider {
    // Inline mock so ProviderRegistry has no circular dep on extension.ts
    return {
      name: 'mock',
      async complete(req) {
        await new Promise(r => setTimeout(r, 500));
        const p = req.userMessage.toLowerCase();
        let content = '🎮 **Demo mode** — add a provider in settings for real AI.\n\n';

        if (p.includes('test'))      { content += '```js\nit("works", () => expect(true).toBe(true));\n```'; }
        else if (p.includes('bug'))  { content += 'Found: missing null-check on line 7.'; }
        else if (p.includes('[]') || p.includes('json')) { content = '[]'; }
        else                         { content += 'I can analyze, debug, refactor, and generate tests.'; }

        return { content, model: 'mock-v1' };
      },
      async ask(prompt) { return (await this.complete({ systemPrompt: '', userMessage: prompt })).content; },
    } as AIProvider;
  }
}