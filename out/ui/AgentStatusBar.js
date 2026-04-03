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
exports.AgentStatusBar = void 0;
const vscode = __importStar(require("vscode"));
// ─────────────────────────────────────────────
//  AgentStatusBar
//  — manages the VS Code status bar item and
//    an optional progress notification for long tasks
// ─────────────────────────────────────────────
class AgentStatusBar {
    constructor(memory, diagnostics, context) {
        this.memory = memory;
        this.diagnostics = diagnostics;
        this.context = context;
        this.providerLabel = '🤖 AI Agent';
        this.currentState = 'idle';
        // Spinner frame index
        this.spinnerIndex = 0;
        // Spinner frames (Braille pattern — smooth in most fonts)
        this.SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        // Primary status item — far right, high priority
        this.primary = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
        this.primary.command = 'aiAgent.openChat';
        context.subscriptions.push(this.primary);
        // Diagnostic count item — just to the left of primary
        this.diagnosticItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 999);
        this.diagnosticItem.command = 'workbench.actions.view.problems';
        context.subscriptions.push(this.diagnosticItem);
        this.renderIdle();
        this.primary.show();
    }
    // ── Lifecycle ─────────────────────────────────
    /**
     * Start periodic refresh and listen for editor changes.
     * Call once from extension activate().
     */
    activate() {
        // Refresh diagnostic badge whenever the active editor changes
        this.context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
            this.refreshDiagnosticBadge();
        }));
        // Refresh every 5 s while idle to pick up async diagnostic updates
        const refreshInterval = setInterval(() => {
            if (this.currentState === 'idle') {
                this.refreshDiagnosticBadge();
            }
        }, 5000);
        this.context.subscriptions.push({
            dispose: () => clearInterval(refreshInterval),
        });
        this.refreshDiagnosticBadge();
    }
    // ── State transitions ─────────────────────────
    setThinking(label = 'Thinking') {
        this.transition('thinking');
        this.startSpinner(label);
    }
    setScanning(label = 'Scanning') {
        this.transition('scanning');
        this.startSpinner(label);
    }
    setSuccess(message = 'Done', autoRevertMs = 3000) {
        this.stopSpinner();
        this.transition('success');
        this.primary.text = `$(check) AI Agent: ${message}`;
        this.primary.tooltip = message;
        this.primary.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
        this.primary.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
        this.scheduleRevert(autoRevertMs);
    }
    setError(message = 'Error', autoRevertMs = 5000) {
        this.stopSpinner();
        this.transition('error');
        this.primary.text = `$(error) AI Agent: ${message.slice(0, 40)}`;
        this.primary.tooltip = `Error: ${message}`;
        this.primary.color = new vscode.ThemeColor('statusBarItem.errorForeground');
        this.primary.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.scheduleRevert(autoRevertMs);
    }
    setIdle() {
        this.stopSpinner();
        this.clearRevert();
        this.transition('idle');
        this.renderIdle();
    }
    // Add inside the AgentStatusBar class, after the existing setIdle() method
    /** Update the provider name shown in the idle status bar label */
    setProviderLabel(label) {
        this.providerLabel = label;
        // Re-render idle state with the new label if we are currently idle
        if (this.currentState === 'idle') {
            this.renderIdle();
        }
    }
    // ── Rendering ─────────────────────────────────
    // Replace the existing renderIdle() method with this version
    renderIdle() {
        const stats = this.memory.getStats();
        const counts = this.diagnostics.getTotalDiagnosticCount();
        const tooltipLines = [
            this.providerLabel,
            '─────────────────────',
            `Memories:       ${stats.totalMemories}`,
            `Conv. turns:    ${stats.conversationTurns}`,
            `Code analyses:  ${stats.byType.codeAnalysis}`,
            `Project ctx:    ${stats.byType.projectContext}`,
            '',
            'Click to open AI chat',
        ];
        this.primary.text = `$(hubot) ${this.providerLabel}`;
        this.primary.tooltip = tooltipLines.join('\n');
        this.primary.color = undefined;
        this.primary.backgroundColor = undefined;
    }
    refreshDiagnosticBadge() {
        const { errors, warnings } = this.diagnostics.getTotalDiagnosticCount();
        if (errors === 0 && warnings === 0) {
            this.diagnosticItem.hide();
            return;
        }
        let text = '';
        if (errors > 0) {
            text += `$(error) ${errors} `;
        }
        if (warnings > 0) {
            text += `$(warning) ${warnings}`;
        }
        this.diagnosticItem.text = text.trim();
        this.diagnosticItem.tooltip =
            `AI Agent found ${errors} error(s) and ${warnings} warning(s)\nClick to open Problems panel`;
        this.diagnosticItem.color = errors > 0
            ? new vscode.ThemeColor('statusBarItem.errorForeground')
            : new vscode.ThemeColor('statusBarItem.warningForeground');
        this.diagnosticItem.backgroundColor = errors > 0
            ? new vscode.ThemeColor('statusBarItem.errorBackground')
            : new vscode.ThemeColor('statusBarItem.warningBackground');
        this.diagnosticItem.show();
    }
    // ── Spinner ───────────────────────────────────
    startSpinner(label) {
        this.stopSpinner(); // clear any existing spinner
        const tick = () => {
            const frame = this.SPINNER[this.spinnerIndex % this.SPINNER.length];
            this.spinnerIndex++;
            this.primary.text = `${frame} AI Agent: ${label}…`;
            this.primary.tooltip = `${label}… (click to open chat)`;
            this.primary.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
            this.primary.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
        };
        tick(); // render first frame immediately
        this.spinnerTimer = setInterval(tick, 100);
    }
    stopSpinner() {
        if (this.spinnerTimer) {
            clearInterval(this.spinnerTimer);
            this.spinnerTimer = undefined;
            this.spinnerIndex = 0;
        }
    }
    // ── Helpers ───────────────────────────────────
    transition(state) {
        this.currentState = state;
    }
    scheduleRevert(ms) {
        this.clearRevert();
        this.revertTimer = setTimeout(() => this.setIdle(), ms);
    }
    clearRevert() {
        if (this.revertTimer) {
            clearTimeout(this.revertTimer);
            this.revertTimer = undefined;
        }
    }
    // ── Progress notification wrapper ─────────────
    /**
     * Convenience wrapper: show a VS Code progress notification
     * while an async task runs, and update status bar accordingly.
     *
     * Usage:
     *   const result = await statusBar.withProgress('Analyzing', () => myTask());
     */
    async withProgress(label, task, isLongRunning = false) {
        this.setThinking(label);
        try {
            const result = await vscode.window.withProgress({
                location: isLongRunning
                    ? vscode.ProgressLocation.Notification
                    : vscode.ProgressLocation.Window,
                title: `AI Agent: ${label}`,
                cancellable: false,
            }, async (progress) => {
                progress.report({ increment: 0 });
                const value = await task();
                progress.report({ increment: 100 });
                return value;
            });
            this.setSuccess(label);
            return result;
        }
        catch (error) {
            this.setError(error.message ?? 'Unknown error');
            throw error;
        }
    }
    // ── Dispose ───────────────────────────────────
    dispose() {
        this.stopSpinner();
        this.clearRevert();
        this.primary.dispose();
        this.diagnosticItem.dispose();
    }
}
exports.AgentStatusBar = AgentStatusBar;
//# sourceMappingURL=AgentStatusBar.js.map