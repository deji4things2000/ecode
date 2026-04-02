import * as vscode         from 'vscode';
import * as path           from 'path';
import { AIProvider, CompletionRequest, CompletionResponse } from './AIProvider';

// ─────────────────────────────────────────────
//  AiderProvider
//  Wraps Aider CLI for git-integrated code editing.
//  Aider runs in a VS Code terminal and edits files
//  directly with full git history.
//  Project: https://github.com/paul-gauthier/aider
// ─────────────────────────────────────────────

export interface AiderConfig {
  // Underlying AI provider Aider should use
  delegateProvider: AIProvider;
  // Path to aider executable (default: 'aider' from PATH)
  aiderPath?:       string;
  // Whether to use --auto-commits (default true)
  autoCommits?:     boolean;
  // Extra aider CLI flags
  extraFlags?:      string[];
  // Cost optimization: show estimated cost before confirming
  showCostEstimate?: boolean;
}

export interface AiderEditResult {
  filesChanged: string[];
  commitHash?:  string;
  commitMsg?:   string;
  cost?:        number;    // USD estimate
}

export class AiderProvider extends AIProvider {
  readonly name        = 'aider';
  readonly displayName = 'Aider';
  readonly description = 'Git-integrated AI coding with cost optimization';
  readonly icon        = '🔀';

  constructor(private readonly config: AiderConfig) {
    super();
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    // For chat-style queries delegate to the underlying provider
    // (Aider's strength is file editing, not chat)
    return this.config.delegateProvider.complete(req);
  }

  // ── Aider-specific: edit files via CLI ────────

  /**
   * Run an Aider edit task in a VS Code terminal.
   * Aider reads the message, edits the relevant files,
   * and commits the changes to git automatically.
   */
  async editWithAider(
    message:   string,
    files:     string[],
    workspaceRoot: string
  ): Promise<void> {
    const terminal = vscode.window.createTerminal({
      name: '🔀 Aider',
      cwd:  workspaceRoot,
    });

    terminal.show();

    const flags = this.buildFlags(files);
    const safeMsg = message.replace(/"/g, '\\"');

    // Run aider in non-interactive mode with the message
    terminal.sendText(
      `${this.config.aiderPath ?? 'aider'} ${flags} --message "${safeMsg}"`
    );
  }

  /**
   * Start an interactive Aider session in a terminal.
   * User can then chat with Aider directly.
   */
  async startInteractiveSession(
    files:         string[],
    workspaceRoot: string
  ): Promise<vscode.Terminal> {
    const terminal = vscode.window.createTerminal({
      name: '🔀 Aider (Interactive)',
      cwd:  workspaceRoot,
    });

    terminal.show();
    const flags = this.buildFlags(files);
    terminal.sendText(`${this.config.aiderPath ?? 'aider'} ${flags}`);

    return terminal;
  }

  /**
   * Generate an Aider-style SEARCH/REPLACE edit block.
   * This is the format Aider uses internally for precise edits.
   */
  async generateEditBlock(
    filePath:    string,
    instruction: string
  ): Promise<string> {
    const response = await this.config.delegateProvider.complete({
      systemPrompt: `You are generating an Aider SEARCH/REPLACE edit block.
Format your response EXACTLY like this — no other text:

path/to/file.ts
\`\`\`typescript
<<<<<<< SEARCH
<exact lines to find>
=======
<replacement lines>
>>>>>>> REPLACE
\`\`\`

Rules:
- SEARCH must match the original file exactly (whitespace included)
- Only include the minimal lines needed for the change
- You may include multiple SEARCH/REPLACE blocks for the same file`,
      userMessage:  `File: ${filePath}\nInstruction: ${instruction}`,
      temperature:  0.1,
      maxTokens:    2_000,
    });

    return response.content;
  }

  /** Estimate the cost of a request in USD */
  estimateCost(
    promptTokens:     number,
    completionTokens: number,
    model:            string
  ): number {
    // Pricing per 1M tokens (approximate, as of 2024)
    const pricing: Record<string, { input: number; output: number }> = {
      'gpt-4o':            { input: 5.00,   output: 15.00  },
      'gpt-4':             { input: 30.00,  output: 60.00  },
      'gpt-3.5-turbo':     { input: 0.50,   output: 1.50   },
      'claude-3-5-sonnet': { input: 3.00,   output: 15.00  },
      'claude-3-opus':     { input: 15.00,  output: 75.00  },
    };

    const key   = Object.keys(pricing).find(k => model.includes(k)) ?? 'gpt-4o';
    const rates = pricing[key];

    return (
      (promptTokens     / 1_000_000) * rates.input  +
      (completionTokens / 1_000_000) * rates.output
    );
  }

  // ── Helpers ───────────────────────────────────

  private buildFlags(files: string[]): string {
    const parts: string[] = [];

    if (this.config.autoCommits === false) {
      parts.push('--no-auto-commits');
    }

    if (this.config.extraFlags?.length) {
      parts.push(...this.config.extraFlags);
    }

    // Add files to edit
    files.forEach(f => parts.push(`"${f}"`));

    return parts.join(' ');
  }
}