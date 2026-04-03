import * as vscode             from 'vscode';
import { AgentMemory }         from './core/AgentMemory';
import { WorkspaceScanner }    from './core/WorkspaceScanner';
import { AgentOrchestrator }   from './agents/AgentOrchestrator';
import { ChatPanel }           from './ui/ChatPanel';
import { DiagnosticsManager }  from './ui/DiagnosticsManager';
import { AgentStatusBar }      from './ui/AgentStatusBar';
import { ProviderRegistry }    from './providers/ProviderRegistry';
import { ProviderQuickPick }   from './ui/ProviderQuickPick';
import { ProviderSelectorPanel } from './ui/ProviderSelectorPanel';


// ─────────────────────────────────────────────
//  Extension lifecycle
// ─────────────────────────────────────────────

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  console.log('Advanced AI Agent activating…');

  // ── Configuration ─────────────────────────────
  const config = vscode.workspace.getConfiguration('aiAgent');

  // ── Memory (must come first — other systems depend on it) ──
  const memory  = new AgentMemory(context, config.get('maxMemoryItems') ?? 50);
  const scanner = new WorkspaceScanner(memory);

  // ── Provider registry ─────────────────────────
  // Always start with Mock (always works). Then try to restore or use configured provider,
  // but ONLY if we can verify it's actually available.
  const mockProvider: any = {
    name: 'mock',
    async complete(req: any) {
      await new Promise(r => setTimeout(r, 500));
      return { content: '🎮 **Demo Mode Active**\n\nThis is mock AI — responses are simulated.\n\n**To use real AI:** Click the **📋 Provider** button in the chat header and select an AI provider (Ollama, OpenAI, Anthropic, etc.).', model: 'mock-v1' };
    },
    async ask(prompt: string) {
      return 'Demo Mode: Use the 📋 Provider button in chat to select a real AI provider.';
    },
  };
  const providerRegistry = new ProviderRegistry(context, mockProvider, 'mock');
  
  // Try to restore the user's last provider, but validate it first
  const saved = context.globalState.get<string>('aiAgent.activeProvider');
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
            await providerRegistry.switchProvider(saved as any);
            console.log(`[AI Agent] Restored provider: ${meta.displayName}`);
          } catch (err: any) {
            console.log(`[AI Agent] Failed to restore ${meta.displayName}, using mock.`);
          }
        } else {
          console.log(`[AI Agent] Provider ${meta.displayName} not available (${meta.status}), using mock.`);
        }
      }
    } catch (err: any) {
      console.log(`[AI Agent] Error checking saved provider, using mock.`);
    }
  }
  
  // If still on mock and a non-mock provider is configured, try to use it
  if (providerRegistry.getProviderID() === 'mock') {
    const configuredID = config.get<string>('primaryProvider');
    if (configuredID && configuredID !== 'mock') {
      try {
        const catalogue = providerRegistry.getCatalogue();
        const meta = catalogue.find(p => p.id === configuredID);
        if (meta) {
          await providerRegistry.detectStatus(meta);
          if (meta.status === 'ready') {
            await providerRegistry.switchProvider(configuredID as any);
            console.log(`[AI Agent] Using configured provider: ${meta.displayName}`);
          }
        }
      } catch (err) {
        console.log(`[AI Agent] Primary provider not available, using mock.`);
      }
    }
  }

  // ── Orchestrator ──────────────────────────────
  const orchestrator = new AgentOrchestrator(
    providerRegistry.getProvider(),
    memory,
    context
  );

  // Re-wire orchestrator whenever the user switches provider
  providerRegistry.onProviderChange((_id, newProvider) => {
    orchestrator.updateProvider(newProvider);
  });

  // ── UI ────────────────────────────────────────
  const diagnosticsManager = new DiagnosticsManager(
    orchestrator,
    memory,
    context
  );
  const statusBar    = new AgentStatusBar(memory, diagnosticsManager, context);
  const quickPick    = new ProviderQuickPick(providerRegistry);

  diagnosticsManager.activate();
  statusBar.activate();
  // Provider quick pick doesn't need activation, but it does need to be instantiated
// Add this command registration inside activate()
  register('aiAgent.openProviderSelector', () => {
    ProviderSelectorPanel.create(providerRegistry, context);
  });
  
  // Keep status bar provider label in sync
  providerRegistry.onProviderChange(() => {
    const meta = providerRegistry.getMeta();
    statusBar.setProviderLabel(`${meta.icon} ${meta.displayName}`);
  });

  // Initialise the label immediately with whatever provider loaded
  statusBar.setProviderLabel(
    `${providerRegistry.getMeta().icon} ${providerRegistry.getMeta().displayName}`
  );

  context.subscriptions.push({ dispose: () => statusBar.dispose() });

  // ── Workspace scan ────────────────────────────
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

  // ─────────────────────────────────────────────
  //  Shared helpers
  // ─────────────────────────────────────────────

  function getEditorCode(editor: vscode.TextEditor): string {
    const sel = editor.selection;
    return sel.isEmpty
      ? editor.document.getText()
      : editor.document.getText(sel);
  }

  /**
   * Run an agent task with a status-bar spinner + progress notification,
   * then open the markdown result in a side panel.
   */
  async function runWithProgress(
    label: string,
    fn:    () => Promise<string>
  ): Promise<void> {
    try {
      const result = await statusBar.withProgress(label, fn, true);
      const doc    = await vscode.workspace.openTextDocument({
        content:  result,
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    } catch (err: any) {
      vscode.window.showErrorMessage(`AI Agent: ${err.message}`);
    }
  }

  function register(
    cmd: string,
    fn:  (...args: unknown[]) => unknown
  ): void {
    context.subscriptions.push(
      vscode.commands.registerCommand(cmd, fn)
    );
  }

  function warn(msg: string): void {
    vscode.window.showWarningMessage(msg);
  }

  // ─────────────────────────────────────────────
  //  Commands
  // ─────────────────────────────────────────────

  // ── Chat panel ────────────────────────────────
  register('aiAgent.openChat', () => {
    ChatPanel.create(orchestrator, memory, providerRegistry, context);
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
    if (!editor) { return warn('No active file to analyze.'); }

    await runWithProgress('Analyzing code', async () => {
      const result = await orchestrator.execute({
        type:     'analysis',
        input:    'Perform deep code analysis',
        context:  getEditorCode(editor),
        filePath: editor.document.fileName,
        language: editor.document.languageId,
      });
      return result.output;
    });
  });

  // ── Refactoring ───────────────────────────────
  register('aiAgent.refactorCode', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return warn('No active file to refactor.'); }

    await runWithProgress('Refactoring', async () => {
      const result = await orchestrator.execute({
        type:     'refactoring',
        input:    'Refactor and improve this code',
        context:  getEditorCode(editor),
        filePath: editor.document.fileName,
        language: editor.document.languageId,
      });

      // Offer to apply if the agent produced code changes
      if (result.codeChanges?.length) {
        const answer = await vscode.window.showInformationMessage(
          'Apply refactored code to editor?',
          'Apply',
          'View Only'
        );

        if (answer === 'Apply') {
          const improved = result.codeChanges[0].improved;
          const edit     = new vscode.WorkspaceEdit();

          edit.replace(
            editor.document.uri,
            new vscode.Range(
              editor.document.positionAt(0),
              editor.document.positionAt(editor.document.getText().length)
            ),
            improved
          );

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
    if (!editor) { return warn('No active file.'); }

    await runWithProgress('Generating tests', async () => {
      const result = await orchestrator.execute({
        type:     'testing',
        input:    'Generate a comprehensive test suite',
        context:  getEditorCode(editor),
        filePath: editor.document.fileName,
        language: editor.document.languageId,
      });
      return result.output;
    });
  });

  // ── Debugging ─────────────────────────────────
  register('aiAgent.debugCode', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return warn('No active file.'); }

    await runWithProgress('Debugging', async () => {
      const result = await orchestrator.execute({
        type:     'debugging',
        input:    'Find and fix all bugs',
        context:  getEditorCode(editor),
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
        type:  'architecture',
        input: 'Analyze the overall project architecture and provide recommendations',
      });
      return result.output;
    });
  });

  // ── Explain selection ─────────────────────────
  register('aiAgent.explainSelection', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return warn('No active file.'); }

    await runWithProgress('Explaining', async () => {
      const result = await orchestrator.execute({
        type:     'analysis',
        input:    'Explain what this code does in clear, simple terms',
        context:  getEditorCode(editor),
        language: editor.document.languageId,
      });
      return result.output;
    });
  });

  // ── Clear memory ──────────────────────────────
  register('aiAgent.clearMemory', async () => {
    await orchestrator.clearAll();
    diagnosticsManager.clearAll();
    statusBar.setSuccess('Memory cleared', 2_000);
    vscode.window.showInformationMessage('🧹 AI Agent memory cleared.');
  });

  // ─────────────────────────────────────────────
  //  Ready notification
  // ─────────────────────────────────────────────

  const meta = providerRegistry.getMeta();
  console.log(`Advanced AI Agent ready — ${meta.icon} ${meta.displayName}`);

  // Auto-open chat on first activation
  vscode.window.showInformationMessage(
    `${meta.icon} AI Agent ready! Start coding.`,
    'Open Chat'
  ).then(btn => {
    if (btn === 'Open Chat') { ChatPanel.create(orchestrator, memory, providerRegistry, context); }
  });
}

// ─────────────────────────────────────────────
//  Deactivation
// ─────────────────────────────────────────────

export function deactivate(): void {
  console.log('Advanced AI Agent deactivated.');
}