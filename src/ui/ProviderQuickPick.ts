import * as vscode from 'vscode';
import {
  ProviderRegistry,
  ProviderID,
  ProviderMeta,
} from '../providers/ProviderRegistry';

// ─────────────────────────────────────────────
//  ProviderQuickPick
//  VS Code quick-pick menu for switching providers
// ─────────────────────────────────────────────

export class ProviderQuickPick {
  constructor(private readonly registry: ProviderRegistry) {}

  async show(): Promise<void> {
    const currentID = this.registry.getProviderID();
    const catalogue = this.registry.getCatalogue();

    // Build quick-pick items
    const items: vscode.QuickPickItem[] = [
      {
        label:       '── Local / Offline ──',
        kind:        vscode.QuickPickItemKind.Separator,
      },
      ...this.buildItems(catalogue.filter(p => p.isLocal),  currentID),
      {
        label:       '── Cloud ──',
        kind:        vscode.QuickPickItemKind.Separator,
      },
      ...this.buildItems(catalogue.filter(p => !p.isLocal), currentID),
    ];

    const pick = await vscode.window.showQuickPick(items, {
      title:        '🤖 AI Agent — Select Provider',
      placeHolder:  'Choose an AI provider or local model server',
      matchOnDetail: true,
    });

    if (!pick || pick.kind === vscode.QuickPickItemKind.Separator) {
      return;
    }

    // Extract provider ID from the label (we encoded it after a tab char)
    const id = (pick as vscode.QuickPickItem & { providerId: ProviderID }).providerId;
    if (!id) { return; }

    // Check if this provider needs setup
    const meta = catalogue.find(p => p.id === id);
    if (meta?.requiresKey) {
      const hasKey = await this.checkApiKey(id);
      if (!hasKey) { return; }
    }

    // Switch provider with progress notification
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title:    `Switching to ${meta?.displayName ?? id}…`,
      },
      async () => {
        try {
          await this.registry.switchProvider(id);
          vscode.window.showInformationMessage(
            `${meta?.icon ?? '🤖'} Switched to ${meta?.displayName ?? id}`
          );
        } catch (err: any) {
          vscode.window.showErrorMessage(
            `Failed to switch provider: ${err.message}`
          );
        }
      }
    );
  }

  // ── Model picker for current provider ────────

  async showModelPicker(): Promise<void> {
    const currentID = this.registry.getProviderID();
    const catalogue = this.registry.getCatalogue();
    const meta      = catalogue.find(p => p.id === currentID);

    if (!meta) { return; }

    // For local providers, try to fetch live model list
    let models = [...meta.models];

    if (currentID === 'ollama') {
      const provider = this.registry.getProvider() as import('../providers/OllamaProvider').OllamaProvider;
      if ('listModels' in provider) {
        const live = await (provider as any).listModels();
        if (live.length) { models = live; }
      }
    }

    if (currentID === 'cortex') {
      const provider = this.registry.getProvider() as import('../providers/CortexProvider').CortexProvider;
      if ('listModels' in provider) {
        const live = await (provider as any).listModels();
        if (live.length) { models = live; }
      }
    }

    const items: vscode.QuickPickItem[] = models.map(m => ({
      label:       m,
      description: m === vscode.workspace.getConfiguration('aiAgent').get(`${currentID}.model`)
        ? '✓ current'
        : '',
    }));

    const pick = await vscode.window.showQuickPick(items, {
      title:       `Select model for ${meta.displayName}`,
      placeHolder: 'Choose a model',
    });

    if (!pick) { return; }

    const config    = vscode.workspace.getConfiguration('aiAgent');
    const configKey = currentID === 'openai' || currentID === 'anthropic'
      ? 'model'
      : `${currentID}.model`;

    await config.update(configKey, pick.label, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Model set to ${pick.label}`);

    // Rebuild the provider with the new model
    await this.registry.switchProvider(currentID);
  }

  // ── Setup wizard for new providers ───────────

  async showSetupWizard(id: ProviderID): Promise<void> {
    const catalogue = this.registry.getCatalogue();
    const meta = catalogue.find(p => p.id === id);
    if (!meta) { return; }

    const steps: Array<() => Promise<boolean>> = [];

    if (meta.isLocal) {
      steps.push(() => this.wizardLocalSetup(meta));
    } else {
      steps.push(() => this.wizardApiKeySetup(meta));
    }

    for (const step of steps) {
      const ok = await step();
      if (!ok) { return; }
    }

    await this.registry.switchProvider(id);
  }

  // ── Helpers ───────────────────────────────────

  private buildItems(
    providers: ProviderMeta[],
    currentID: ProviderID
  ): Array<vscode.QuickPickItem & { providerId: ProviderID }> {
    return providers.map(p => ({
      providerId:  p.id,
      label:       `${p.icon}  ${p.displayName}${p.id === currentID ? ' ✓' : ''}`,
      description: p.requiresKey ? '🔑 Requires API key' : '🆓 No key needed',
      detail:      `${p.strength}${p.setupUrl ? `  ·  ${p.setupUrl}` : ''}`,
      alwaysShow:  true,
    }));
  }

  private async checkApiKey(id: ProviderID): Promise<boolean> {
    const config = vscode.workspace.getConfiguration('aiAgent');
    const keyMap: Partial<Record<ProviderID, string>> = {
      openai:    'openaiApiKey',
      anthropic: 'anthropicApiKey',
    };
    const key = keyMap[id];
    if (!key) { return true; }

    const value = config.get<string>(key);
    if (value) { return true; }

    const answer = await vscode.window.showWarningMessage(
      `${id === 'openai' ? 'OpenAI' : 'Anthropic'} requires an API key.`,
      'Open Settings', 'Cancel'
    );
    if (answer === 'Open Settings') {
      vscode.commands.executeCommand('workbench.action.openSettings', `aiAgent.${key}`);
    }
    return false;
  }

  private async wizardLocalSetup(meta: ProviderMeta): Promise<boolean> {
    const answer = await vscode.window.showInformationMessage(
      [
        `${meta.icon} Setting up ${meta.displayName}`,
        '',
        meta.description,
        '',
        `You will need to install ${meta.displayName} separately.`,
      ].join('\n'),
      'Open Download Page',
      'I Already Have It',
      'Cancel'
    );

    if (answer === 'Open Download Page' && meta.setupUrl) {
      vscode.env.openExternal(vscode.Uri.parse(meta.setupUrl));
      return false;
    }
    return answer === 'I Already Have It';
  }

  private async wizardApiKeySetup(meta: ProviderMeta): Promise<boolean> {
    const key = await vscode.window.showInputBox({
      title:       `${meta.icon} Enter your ${meta.displayName} API key`,
      prompt:      `Paste your ${meta.displayName} API key`,
      password:    true,
      placeHolder: 'sk-…',
      validateInput: v => v?.length > 10 ? null : 'Key looks too short',
    });

    if (!key) { return false; }

    const config    = vscode.workspace.getConfiguration('aiAgent');
    const configKey = meta.id === 'openai' ? 'openaiApiKey' : 'anthropicApiKey';
    await config.update(configKey, key, vscode.ConfigurationTarget.Global);
    return true;
  }
}