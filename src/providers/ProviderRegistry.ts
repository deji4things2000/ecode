import * as vscode            from 'vscode';
import * as cp                from 'child_process';
import * as util              from 'util';
import { AIProvider }         from './AIProvider';
import { OpenAIProvider }     from './OpenAIProvider';
import { AnthropicProvider }  from './AnthropicProvider';
import { OllamaProvider }     from './OllamaProvider';
import { ClineProvider }      from './ClineProvider';
import { AiderProvider }      from './AiderProvider';
import { CortexProvider }     from './CortexProvider';
import { LocalLLMProvider }   from './LocalLLMProvider';

const exec = util.promisify(cp.exec);

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

export type ProviderStatus =
  | 'ready'          // detected and reachable
  | 'not-installed'  // binary / app not found
  | 'not-running'    // installed but server is down
  | 'needs-key'      // cloud provider with no API key set
  | 'checking'       // status check in progress
  | 'unknown';

export interface ProviderMeta {
  id:           ProviderID;
  displayName:  string;
  description:  string;
  icon:         string;
  requiresKey:  boolean;
  isLocal:      boolean;
  setupUrl:     string;
  installCmd?:  string;    // terminal command to install
  startCmd?:    string;    // terminal command to start server
  models:       string[];
  strength:     string;
  status:       ProviderStatus;
}

// ─────────────────────────────────────────────
//  Provider catalogue
// ─────────────────────────────────────────────

export function buildCatalogue(): ProviderMeta[] {
  return [
    {
      id:          'ollama',
      displayName: 'Ollama',
      description: 'Run LLMs locally — no API key, full privacy',
      icon:        '🦙',
      requiresKey: false,
      isLocal:     true,
      setupUrl:    'https://ollama.com/download',
      installCmd:  process.platform === 'darwin'
                     ? 'brew install ollama'
                     : 'curl -fsSL https://ollama.com/install.sh | sh',
      startCmd:    'ollama serve',
      models:      ['llama3.2', 'codellama', 'deepseek-coder', 'qwen2.5-coder', 'mistral'],
      strength:    'Easiest setup · Full features · No cost',
      status:      'unknown',
    },
    {
      id:          'localllm',
      displayName: 'LM Studio',
      description: 'Fast completions via LM Studio desktop app',
      icon:        '💻',
      requiresKey: false,
      isLocal:     true,
      setupUrl:    'https://lmstudio.ai',
      startCmd:    'open -a "LM Studio"',
      models:      ['local-model'],
      strength:    'Fastest completions · Desktop app · Zero cost',
      status:      'unknown',
    },
    {
      id:          'cortex',
      displayName: 'CortexIDE',
      description: 'Privacy-first local LLM — Cursor alternative',
      icon:        '🧠',
      requiresKey: false,
      isLocal:     true,
      setupUrl:    'https://cortex.so/docs',
      installCmd:  'npm install -g @janhq/cortexso',
      startCmd:    'cortex start',
      models:      ['cortexso/llama3.2', 'cortexso/mistral'],
      strength:    'Privacy-first · No telemetry · Local',
      status:      'unknown',
    },
    {
      id:          'cline',
      displayName: 'Cline',
      description: 'Most popular open-source agent with MCP tools',
      icon:        '🔧',
      requiresKey: false,
      isLocal:     false,
      setupUrl:    'https://github.com/cline/cline',
      installCmd:  'code --install-extension saoudrizwan.claude-dev',
      models:      ['claude-3-5-sonnet-20241022', 'gpt-4o'],
      strength:    'Most popular · MCP tools · Advanced workflows',
      status:      'unknown',
    },
    {
      id:          'aider',
      displayName: 'Aider',
      description: 'Git-integrated AI coding with cost optimization',
      icon:        '🔀',
      requiresKey: false,
      isLocal:     false,
      setupUrl:    'https://aider.chat/docs/install.html',
      installCmd:  'pip install aider-chat',
      models:      ['gpt-4o', 'claude-3-5-sonnet-20241022'],
      strength:    'Git integration · Cost optimization · Terminal',
      status:      'unknown',
    },
    {
      id:          'openai',
      displayName: 'OpenAI',
      description: 'GPT-4o — highest quality cloud AI',
      icon:        '✨',
      requiresKey: true,
      isLocal:     false,
      setupUrl:    'https://platform.openai.com/api-keys',
      models:      ['gpt-4o', 'gpt-4', 'gpt-3.5-turbo'],
      strength:    'Highest quality · Best reasoning · Widely tested',
      status:      'unknown',
    },
    {
      id:          'anthropic',
      displayName: 'Anthropic Claude',
      description: 'Claude 3.5 Sonnet — excellent long context',
      icon:        '🌟',
      requiresKey: true,
      isLocal:     false,
      setupUrl:    'https://console.anthropic.com',
      models:      ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'],
      strength:    'Long context · Nuanced analysis · Safety-focused',
      status:      'unknown',
    },
    {
      id:          'mock',
      displayName: 'Demo Mode',
      description: 'Test the full UI — no setup needed',
      icon:        '🎮',
      requiresKey: false,
      isLocal:     true,
      setupUrl:    '',
      models:      ['mock-v1'],
      strength:    'Zero setup · UI testing · Always works',
      status:      'ready',
    },
  ];
}

// ─────────────────────────────────────────────
//  ProviderRegistry
// ─────────────────────────────────────────────

export class ProviderRegistry {
  private activeProvider:   AIProvider;
  private activeProviderID: ProviderID;
  private catalogue:        ProviderMeta[];
  private readonly listeners: Array<(id: ProviderID, p: AIProvider) => void> = [];
  private readonly installListeners: Array<(id: ProviderID, status: 'installing' | 'checking' | 'ready' | 'failed') => void> = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    initialProvider: AIProvider,
    initialID:       ProviderID
  ) {
    this.activeProvider   = initialProvider;
    this.activeProviderID = initialID;
    this.catalogue        = buildCatalogue();
  }

  // ── Getters ───────────────────────────────────

  getProvider():   AIProvider   { return this.activeProvider;   }
  getProviderID(): ProviderID   { return this.activeProviderID; }
  getCatalogue():  ProviderMeta[] { return this.catalogue;      }

  getMeta(id?: ProviderID): ProviderMeta {
    return this.catalogue.find(p => p.id === (id ?? this.activeProviderID))
      ?? this.catalogue[this.catalogue.length - 1];
  }

  // ── Status detection ──────────────────────────

  /**
   * Check every provider's status in parallel.
   * Updates the catalogue in-place so the UI can show
   * green/red indicators without blocking.
   */
  async detectAllStatuses(): Promise<void> {
    await Promise.all(
      this.catalogue.map(meta => this.detectStatus(meta))
    );
  }

  async detectStatus(meta: ProviderMeta): Promise<ProviderStatus> {
    meta.status = 'checking';

    try {
      let status: ProviderStatus = 'unknown';

      switch (meta.id) {

        case 'ollama': {
          const installed = await this.commandExists('ollama');
          if (!installed) { status = 'not-installed'; break; }
          const running = await this.portOpen('localhost', 11434);
          status = running ? 'ready' : 'not-running';
          break;
        }

        case 'cortex': {
          const installed = await this.commandExists('cortex');
          if (!installed) { status = 'not-installed'; break; }
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
          const key    = config.get<string>('openaiApiKey') ?? '';
          status = key.length > 10 ? 'ready' : 'needs-key';
          break;
        }

        case 'anthropic': {
          const config = vscode.workspace.getConfiguration('aiAgent');
          const key    = config.get<string>('anthropicApiKey') ?? '';
          status = key.length > 10 ? 'ready' : 'needs-key';
          break;
        }

        case 'mock':
          status = 'ready';
          break;
      }

      meta.status = status;
      return status;

    } catch {
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
  async autoInstall(
    id: ProviderID
  ): Promise<boolean> {
    const meta = this.getMeta(id);
    if (!meta.installCmd) { return false; }

    const terminal = vscode.window.createTerminal({
      name: `Install ${meta.displayName}`,
    });
    terminal.show();
    terminal.sendText(meta.installCmd + '; echo "INSTALL_COMPLETE"');

    // Emit 'installing' status immediately
    this.emitInstallProgress(id, 'installing');

    // For Ollama on Mac, also offer brew cask
    if (id === 'ollama' && process.platform === 'darwin') {
      const answer = await vscode.window.showInformationMessage(
        '🦙 Installing Ollama via Homebrew. If brew is not installed, download from ollama.com instead.',
        'Open Download Page',
        'Continue with brew'
      );
      if (answer === 'Open Download Page') {
        vscode.env.openExternal(vscode.Uri.parse(meta.setupUrl));
        return false;
      }
    }

    // Poll for completion by checking if command now exists
    // Wait up to 10 minutes for install to complete
    const maxAttempts = 120; // 120 * 5 seconds = 10 minutes
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 5_000)); // Check every 5 seconds

      // Emit 'checking' status after a few seconds
      if (i === 2) {
        this.emitInstallProgress(id, 'checking');
      }

      const prevStatus = meta.status;
      await this.detectStatus(meta);

      // If status changed to ready, install succeeded
      if (meta.status === 'ready' && prevStatus !== 'ready') {
        this.emitInstallProgress(id, 'ready');
        vscode.window.showInformationMessage(
          `✅ ${meta.displayName} installed successfully! Ready to use.`
        );
        return true;
      }

      // If 'not-running', installation likely succeeded but server not started
      if (meta.status === 'not-running' && i > 20) {
        this.emitInstallProgress(id, 'ready');
        vscode.window.showInformationMessage(
          `✅ ${meta.displayName} installed! You can now start the server.`
        );
        return true;
      }
    }

    // Timeout after 10 minutes
    this.emitInstallProgress(id, 'failed');
    vscode.window.showWarningMessage(
      `⏱️ Installation timeout. Please check the terminal for errors.`
    );
    return false;
  }

  /**
   * Start a local provider's server in a terminal.
   */
  async autoStart(id: ProviderID): Promise<void> {
    const meta = this.getMeta(id);
    if (!meta.startCmd) { return; }

    const terminal = vscode.window.createTerminal({
      name: `${meta.icon} ${meta.displayName}`,
    });
    terminal.show();
    terminal.sendText(meta.startCmd);

    // Wait 3 seconds then re-check status
    await new Promise(r => setTimeout(r, 3_000));
    await this.detectStatus(meta);
  }

  // ── Switching ─────────────────────────────────

  async switchProvider(id: ProviderID): Promise<AIProvider> {
    const meta     = this.getMeta(id);
    const provider = await this.build(id);

    this.activeProvider   = provider;
    this.activeProviderID = id;

    await this.context.globalState.update('aiAgent.activeProvider', id);
    this.listeners.forEach(fn => fn(id, provider));

    return provider;
  }

  onProviderChange(
    fn: (id: ProviderID, provider: AIProvider) => void
  ): void {
    this.listeners.push(fn);
  }

  onInstallProgress(
    fn: (id: ProviderID, status: 'installing' | 'checking' | 'ready' | 'failed') => void
  ): void {
    this.installListeners.push(fn);
  }

  private emitInstallProgress(id: ProviderID, status: 'installing' | 'checking' | 'ready' | 'failed'): void {
    this.installListeners.forEach(fn => fn(id, status));
  }

  async restoreProvider(): Promise<void> {
    const saved = this.context.globalState.get<ProviderID>(
      'aiAgent.activeProvider'
    );
    if (saved && saved !== this.activeProviderID) {
      await this.switchProvider(saved).catch(() => {});
    }
  }

  // ── Factory ───────────────────────────────────

  async build(id: ProviderID): Promise<AIProvider> {
    const config = vscode.workspace.getConfiguration('aiAgent');

    switch (id) {
      case 'openai': {
        const key   = config.get<string>('openaiApiKey') ?? '';
        const model = config.get<string>('model') ?? 'gpt-4o';
        return new OpenAIProvider(key, model);
      }
      case 'anthropic': {
        const key   = config.get<string>('anthropicApiKey') ?? '';
        const model = config.get<string>('model') ?? 'claude-3-5-sonnet-20241022';
        return new AnthropicProvider(key, model);
      }
      case 'ollama': {
        return new OllamaProvider({
          baseUrl: config.get<string>('ollama.baseUrl') ?? 'http://localhost:11434',
          model:   config.get<string>('ollama.model')   ?? 'llama3.2',
        });
      }
      case 'cline': {
        const delegateID = config.get<string>('cline.delegateProvider') ?? 'openai';
        const delegate   = await this.build(delegateID as ProviderID);
        const mcpServers = config.get<Record<string, string>>('cline.mcpServers') ?? {};
        return new ClineProvider({
          delegateProvider:  delegate,
          mcpServers,
          useClineExtension: config.get<boolean>('cline.useExtension') ?? true,
        });
      }
      case 'aider': {
        const delegateID = config.get<string>('aider.delegateProvider') ?? 'openai';
        const delegate   = await this.build(delegateID as ProviderID);
        return new AiderProvider({
          delegateProvider: delegate,
          aiderPath:        config.get<string>('aider.path')         ?? 'aider',
          autoCommits:      config.get<boolean>('aider.autoCommits') ?? true,
        });
      }
      case 'cortex': {
        return new CortexProvider({
          baseUrl: config.get<string>('cortex.baseUrl') ?? 'http://localhost:39281',
          model:   config.get<string>('cortex.model')   ?? 'cortexso/llama3.2',
        });
      }
      case 'localllm': {
        return new LocalLLMProvider({
          backend:     (config.get<string>('localllm.backend') ?? 'lmstudio') as any,
          baseUrl:     config.get<string>('localllm.baseUrl'),
          model:       config.get<string>('localllm.model') ?? 'local-model',
          contextSize: config.get<number>('localllm.contextSize') ?? 4_096,
        });
      }
      case 'mock':
      default:
        return this.buildMock();
    }
  }

  // ── Utility helpers ───────────────────────────

  private async commandExists(cmd: string): Promise<boolean> {
    try {
      const which = process.platform === 'win32' ? 'where' : 'which';
      await exec(`${which} ${cmd}`);
      return true;
    } catch {
      return false;
    }
  }

  private portOpen(host: string, port: number): Promise<boolean> {
    return new Promise(resolve => {
      const net    = require('net');
      const socket = new net.Socket();
      const timer  = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 2_000);

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

  private buildMock(): AIProvider {
    return {
      name: 'mock',
      async complete(req) {
        await new Promise(r => setTimeout(r, 500));
        const p = req.userMessage.toLowerCase();
        let content = '🎮 **Demo mode** — add a provider to get real AI responses.\n\n';
        if (p.includes('test'))     { content += '```js\nit("works", () => expect(true).toBe(true));\n```'; }
        else if (p.includes('bug')) { content += 'Found: missing null-check on line 7.'; }
        else                        { content += 'I can analyze, debug, refactor, and generate tests.'; }
        return { content, model: 'mock-v1' };
      },
      async ask(prompt) {
        return (await this.complete({ systemPrompt: '', userMessage: prompt })).content;
      },
    } as AIProvider;
  }
}