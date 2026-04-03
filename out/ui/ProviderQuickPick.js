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
exports.ProviderQuickPick = void 0;
const vscode = __importStar(require("vscode"));
const ProviderRegistry_1 = require("../providers/ProviderRegistry");
// ─────────────────────────────────────────────
//  ProviderQuickPick
//  VS Code quick-pick menu for switching providers
// ─────────────────────────────────────────────
class ProviderQuickPick {
    constructor(registry) {
        this.registry = registry;
    }
    async show() {
        const currentID = this.registry.getProviderID();
        // Build quick-pick items
        const items = [
            {
                label: '── Local / Offline ──',
                kind: vscode.QuickPickItemKind.Separator,
            },
            ...this.buildItems(ProviderRegistry_1.PROVIDER_CATALOGUE.filter(p => p.isLocal), currentID),
            {
                label: '── Cloud ──',
                kind: vscode.QuickPickItemKind.Separator,
            },
            ...this.buildItems(ProviderRegistry_1.PROVIDER_CATALOGUE.filter(p => !p.isLocal), currentID),
        ];
        const pick = await vscode.window.showQuickPick(items, {
            title: '🤖 AI Agent — Select Provider',
            placeHolder: 'Choose an AI provider or local model server',
            matchOnDetail: true,
        });
        if (!pick || pick.kind === vscode.QuickPickItemKind.Separator) {
            return;
        }
        // Extract provider ID from the label (we encoded it after a tab char)
        const id = pick.providerId;
        if (!id) {
            return;
        }
        // Check if this provider needs setup
        const meta = ProviderRegistry_1.PROVIDER_CATALOGUE.find(p => p.id === id);
        if (meta?.requiresKey) {
            const hasKey = await this.checkApiKey(id);
            if (!hasKey) {
                return;
            }
        }
        // Switch provider with progress notification
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Switching to ${meta?.displayName ?? id}…`,
        }, async () => {
            try {
                await this.registry.switchProvider(id);
                vscode.window.showInformationMessage(`${meta?.icon ?? '🤖'} Switched to ${meta?.displayName ?? id}`);
            }
            catch (err) {
                vscode.window.showErrorMessage(`Failed to switch provider: ${err.message}`);
            }
        });
    }
    // ── Model picker for current provider ────────
    async showModelPicker() {
        const currentID = this.registry.getProviderID();
        const meta = ProviderRegistry_1.PROVIDER_CATALOGUE.find(p => p.id === currentID);
        if (!meta) {
            return;
        }
        // For local providers, try to fetch live model list
        let models = [...meta.models];
        if (currentID === 'ollama') {
            const provider = this.registry.getProvider();
            if ('listModels' in provider) {
                const live = await provider.listModels();
                if (live.length) {
                    models = live;
                }
            }
        }
        if (currentID === 'cortex') {
            const provider = this.registry.getProvider();
            if ('listModels' in provider) {
                const live = await provider.listModels();
                if (live.length) {
                    models = live;
                }
            }
        }
        const items = models.map(m => ({
            label: m,
            description: m === vscode.workspace.getConfiguration('aiAgent').get(`${currentID}.model`)
                ? '✓ current'
                : '',
        }));
        const pick = await vscode.window.showQuickPick(items, {
            title: `Select model for ${meta.displayName}`,
            placeHolder: 'Choose a model',
        });
        if (!pick) {
            return;
        }
        const config = vscode.workspace.getConfiguration('aiAgent');
        const configKey = currentID === 'openai' || currentID === 'anthropic'
            ? 'model'
            : `${currentID}.model`;
        await config.update(configKey, pick.label, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Model set to ${pick.label}`);
        // Rebuild the provider with the new model
        await this.registry.switchProvider(currentID);
    }
    // ── Setup wizard for new providers ───────────
    async showSetupWizard(id) {
        const meta = ProviderRegistry_1.PROVIDER_CATALOGUE.find(p => p.id === id);
        if (!meta) {
            return;
        }
        const steps = [];
        if (meta.isLocal) {
            steps.push(() => this.wizardLocalSetup(meta));
        }
        else {
            steps.push(() => this.wizardApiKeySetup(meta));
        }
        for (const step of steps) {
            const ok = await step();
            if (!ok) {
                return;
            }
        }
        await this.registry.switchProvider(id);
    }
    // ── Helpers ───────────────────────────────────
    buildItems(providers, currentID) {
        return providers.map(p => ({
            providerId: p.id,
            label: `${p.icon}  ${p.displayName}${p.id === currentID ? ' ✓' : ''}`,
            description: p.requiresKey ? '🔑 Requires API key' : '🆓 No key needed',
            detail: `${p.strength}${p.setupUrl ? `  ·  ${p.setupUrl}` : ''}`,
            alwaysShow: true,
        }));
    }
    async checkApiKey(id) {
        const config = vscode.workspace.getConfiguration('aiAgent');
        const keyMap = {
            openai: 'openaiApiKey',
            anthropic: 'anthropicApiKey',
        };
        const key = keyMap[id];
        if (!key) {
            return true;
        }
        const value = config.get(key);
        if (value) {
            return true;
        }
        const answer = await vscode.window.showWarningMessage(`${id === 'openai' ? 'OpenAI' : 'Anthropic'} requires an API key.`, 'Open Settings', 'Cancel');
        if (answer === 'Open Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', `aiAgent.${key}`);
        }
        return false;
    }
    async wizardLocalSetup(meta) {
        const answer = await vscode.window.showInformationMessage([
            `${meta.icon} Setting up ${meta.displayName}`,
            '',
            meta.description,
            '',
            `You will need to install ${meta.displayName} separately.`,
        ].join('\n'), 'Open Download Page', 'I Already Have It', 'Cancel');
        if (answer === 'Open Download Page' && meta.setupUrl) {
            vscode.env.openExternal(vscode.Uri.parse(meta.setupUrl));
            return false;
        }
        return answer === 'I Already Have It';
    }
    async wizardApiKeySetup(meta) {
        const key = await vscode.window.showInputBox({
            title: `${meta.icon} Enter your ${meta.displayName} API key`,
            prompt: `Paste your ${meta.displayName} API key`,
            password: true,
            placeHolder: 'sk-…',
            validateInput: v => v?.length > 10 ? null : 'Key looks too short',
        });
        if (!key) {
            return false;
        }
        const config = vscode.workspace.getConfiguration('aiAgent');
        const configKey = meta.id === 'openai' ? 'openaiApiKey' : 'anthropicApiKey';
        await config.update(configKey, key, vscode.ConfigurationTarget.Global);
        return true;
    }
}
exports.ProviderQuickPick = ProviderQuickPick;
//# sourceMappingURL=ProviderQuickPick.js.map