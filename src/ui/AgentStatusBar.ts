import * as vscode from 'vscode';
import { AgentMemory } from '../core/AgentMemory';
import { DiagnosticsManager } from './DiagnosticsManager';

// ─────────────────────────────────────────────
//  AgentState — drives status bar appearance
// ─────────────────────────────────────────────

export type AgentState =
    | 'idle'
    | 'thinking'
    | 'scanning'
    | 'error'
    | 'success';

// ─────────────────────────────────────────────
//  AgentStatusBar
//  — manages the VS Code status bar item and
//    an optional progress notification for long tasks
// ─────────────────────────────────────────────

export class AgentStatusBar {
    // Primary item (always visible, right-aligned)
    private readonly primary: vscode.StatusBarItem;

    // Secondary item shows diagnostic counts
    private readonly diagnosticItem: vscode.StatusBarItem;

    private currentState: AgentState = 'idle';

    // Spinner frame index
    private spinnerIndex = 0;
    private spinnerTimer?: NodeJS.Timeout;

    // Spinner frames (Braille pattern — smooth in most fonts)
    private readonly SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

    // Auto-revert to idle after showing success/error
    private revertTimer?: NodeJS.Timeout;

    constructor(
        private readonly memory: AgentMemory,
        private readonly diagnostics: DiagnosticsManager,
        private readonly context: vscode.ExtensionContext
    ) {
        // Primary status item — far right, high priority
        this.primary = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            1000
        );
        this.primary.command = 'aiAgent.openChat';
        context.subscriptions.push(this.primary);

        // Diagnostic count item — just to the left of primary
        this.diagnosticItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            999
        );
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
    activate(): void {
        // Refresh diagnostic badge whenever the active editor changes
        this.context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(() => {
                this.refreshDiagnosticBadge();
            })
        );

        // Refresh every 5 s while idle to pick up async diagnostic updates
        const refreshInterval = setInterval(() => {
            if (this.currentState === 'idle') {
                this.refreshDiagnosticBadge();
            }
        }, 5_000);

        this.context.subscriptions.push({
            dispose: () => clearInterval(refreshInterval),
        });

        this.refreshDiagnosticBadge();
    }

    // ── State transitions ─────────────────────────

    setThinking(label = 'Thinking'): void {
        this.transition('thinking');
        this.startSpinner(label);
    }

    setScanning(label = 'Scanning'): void {
        this.transition('scanning');
        this.startSpinner(label);
    }

    setSuccess(message = 'Done', autoRevertMs = 3_000): void {
        this.stopSpinner();
        this.transition('success');

        this.primary.text = `$(check) AI Agent: ${message}`;
        this.primary.tooltip = message;
        this.primary.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
        this.primary.backgroundColor = new vscode.ThemeColor(
            'statusBarItem.prominentBackground'
        );

        this.scheduleRevert(autoRevertMs);
    }

    setError(message = 'Error', autoRevertMs = 5_000): void {
        this.stopSpinner();
        this.transition('error');

        this.primary.text = `$(error) AI Agent: ${message.slice(0, 40)}`;
        this.primary.tooltip = `Error: ${message}`;
        this.primary.color = new vscode.ThemeColor('statusBarItem.errorForeground');
        this.primary.backgroundColor = new vscode.ThemeColor(
            'statusBarItem.errorBackground'
        );

        this.scheduleRevert(autoRevertMs);
    }

    setIdle(): void {
        this.stopSpinner();
        this.clearRevert();
        this.transition('idle');
        this.renderIdle();
    }

    // ── Rendering ─────────────────────────────────

    private renderIdle(): void {
        const stats = this.memory.getStats();
        const counts = this.diagnostics.getTotalDiagnosticCount();

        // Build tooltip with memory info
        const tooltipLines = [
            '🤖 Advanced AI Agent',
            '─────────────────────',
            `Memories:       ${stats.totalMemories}`,
            `Conv. turns:    ${stats.conversationTurns}`,
            `Code analyses:  ${stats.byType.codeAnalysis}`,
            `Project ctx:    ${stats.byType.projectContext}`,
            '',
            'Click to open AI chat',
        ];

        this.primary.text = '$(hubot) AI Agent';
        this.primary.tooltip = tooltipLines.join('\n');
        this.primary.color = undefined;
        this.primary.backgroundColor = undefined;
    }

    private refreshDiagnosticBadge(): void {
        const { errors, warnings } = this.diagnostics.getTotalDiagnosticCount();

        if (errors === 0 && warnings === 0) {
            this.diagnosticItem.hide();
            return;
        }

        let text = '';
        if (errors > 0) { text += `$(error) ${errors} `; }
        if (warnings > 0) { text += `$(warning) ${warnings}`; }

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

    private startSpinner(label: string): void {
        this.stopSpinner();   // clear any existing spinner

        const tick = (): void => {
            const frame = this.SPINNER[this.spinnerIndex % this.SPINNER.length];
            this.spinnerIndex++;
            this.primary.text = `${frame} AI Agent: ${label}…`;
            this.primary.tooltip = `${label}… (click to open chat)`;
            this.primary.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
            this.primary.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.prominentBackground'
            );
        };

        tick();  // render first frame immediately
        this.spinnerTimer = setInterval(tick, 100);
    }

    private stopSpinner(): void {
        if (this.spinnerTimer) {
            clearInterval(this.spinnerTimer);
            this.spinnerTimer = undefined;
            this.spinnerIndex = 0;
        }
    }

    // ── Helpers ───────────────────────────────────

    private transition(state: AgentState): void {
        this.currentState = state;
    }

    private scheduleRevert(ms: number): void {
        this.clearRevert();
        this.revertTimer = setTimeout(() => this.setIdle(), ms);
    }

    private clearRevert(): void {
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
    async withProgress<T>(
        label: string,
        task: () => Promise<T>,
        isLongRunning = false
    ): Promise<T> {
        this.setThinking(label);

        try {
            const result = await vscode.window.withProgress(
                {
                    location: isLongRunning
                        ? vscode.ProgressLocation.Notification
                        : vscode.ProgressLocation.Window,
                    title: `AI Agent: ${label}`,
                    cancellable: false,
                },
                async (progress) => {
                    progress.report({ increment: 0 });
                    const value = await task();
                    progress.report({ increment: 100 });
                    return value;
                }
            );

            this.setSuccess(label);
            return result;

        } catch (error: any) {
            this.setError(error.message ?? 'Unknown error');
            throw error;
        }
    }

    // ── Dispose ───────────────────────────────────

    dispose(): void {
        this.stopSpinner();
        this.clearRevert();
        this.primary.dispose();
        this.diagnosticItem.dispose();
    }
}