import * as vscode         from 'vscode';
import { AIProvider, CompletionRequest, CompletionResponse } from './AIProvider';

const fetch = require('node-fetch');

// ─────────────────────────────────────────────
//  ClineProvider
//  Bridges to Cline (VS Code extension) via its
//  extension API and optionally MCP (Model Context
//  Protocol) tool servers.
//  Project: https://github.com/cline/cline
// ─────────────────────────────────────────────

export interface ClineConfig {
  // Cline delegates to an underlying AI provider
  delegateProvider: AIProvider;
  // Optional MCP server endpoints  { name → url }
  mcpServers?: Record<string, string>;
  // Whether to use Cline's task API when installed
  useClineExtension?: boolean;
}

export interface MCPTool {
  name:        string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class ClineProvider extends AIProvider {
  readonly name        = 'cline';
  readonly displayName = 'Cline';
  readonly description = 'Most popular open-source agent with MCP tool support';
  readonly icon        = '🔧';

  private mcpTools: MCPTool[] = [];

  constructor(private readonly config: ClineConfig) {
    super();
    if (config.mcpServers) {
      this.loadMCPTools(config.mcpServers);
    }
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    // ── Try Cline extension API first ────────────
    if (this.config.useClineExtension) {
      const result = await this.tryViaClineExtension(req);
      if (result) { return result; }
    }

    // ── Inject MCP tool schemas into system prompt ─
    const enhancedSystem = this.mcpTools.length
      ? `${req.systemPrompt}\n\n${this.buildMCPToolPrompt()}`
      : req.systemPrompt;

    // ── Delegate to underlying provider ──────────
    return this.config.delegateProvider.complete({
      ...req,
      systemPrompt: enhancedSystem,
    });
  }

  // ── Cline extension API ───────────────────────

  private async tryViaClineExtension(
    req: CompletionRequest
  ): Promise<CompletionResponse | null> {
    try {
      const clineExt = vscode.extensions.getExtension('saoudrizwan.claude-dev');
      if (!clineExt) { return null; }

      if (!clineExt.isActive) {
        await clineExt.activate();
      }

      const api = clineExt.exports;
      if (!api?.startNewTask) { return null; }

      // Use Cline's task API for autonomous agent tasks
      const taskId = await api.startNewTask({
        task:             req.userMessage,
        configuration:    { systemPrompt: req.systemPrompt },
      });

      // Poll for completion (Cline tasks are async)
      const result = await this.pollClineTask(api, taskId, 60_000);
      return {
        content: result,
        model:   'cline',
      };

    } catch {
      return null;   // fall through to delegate provider
    }
  }

  private async pollClineTask(
    api:       unknown,
    taskId:    string,
    timeoutMs: number
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    const a = api as Record<string, (id: string) => Promise<{
      status: string; result?: string;
    }>>;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1_000));
      const status = await a.getTaskStatus(taskId);
      if (status.status === 'completed') {
        return status.result ?? 'Task completed.';
      }
      if (status.status === 'error') {
        throw new Error('Cline task failed');
      }
    }

    throw new Error('Cline task timed out');
  }

  // ── MCP (Model Context Protocol) ─────────────

  private async loadMCPTools(
    servers: Record<string, string>
  ): Promise<void> {
    for (const [name, url] of Object.entries(servers)) {
      try {
        const response = await fetch(`${url}/tools/list`, {
          headers: { 'Content-Type': 'application/json' },
        });
        if (!response.ok) { continue; }
        const data: { tools: MCPTool[] } = await response.json();
        this.mcpTools.push(...(data.tools ?? []));
        console.log(`[ClineProvider] Loaded ${data.tools?.length ?? 0} tools from MCP server: ${name}`);
      } catch (err) {
        console.warn(`[ClineProvider] Could not load MCP server ${name}:`, err);
      }
    }
  }

  async callMCPTool(
    serverUrl: string,
    toolName:  string,
    args:      Record<string, unknown>
  ): Promise<unknown> {
    const response = await fetch(`${serverUrl}/tools/call`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: toolName, arguments: args }),
    });

    if (!response.ok) {
      throw new Error(`MCP tool call failed: ${response.statusText}`);
    }

    return response.json();
  }

  private buildMCPToolPrompt(): string {
    if (!this.mcpTools.length) { return ''; }

    const toolList = this.mcpTools
      .map(t => `- ${t.name}: ${t.description}`)
      .join('\n');

    return [
      'Available MCP Tools (call via tool-use API):',
      toolList,
    ].join('\n');
  }

  getMCPTools(): MCPTool[] {
    return [...this.mcpTools];
  }
}