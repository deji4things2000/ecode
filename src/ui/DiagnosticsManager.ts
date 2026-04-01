import * as vscode from 'vscode';
import { AgentOrchestrator } from '../agents/AgentOrchestrator';
import { AgentMemory } from '../core/AgentMemory';

// ─────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────

export interface DiagnosticIssue {
    message: string;
    severity: 'error' | 'warning' | 'info' | 'hint';
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
    code: string;
    source: string;
    fix?: string;   // suggested replacement text
}

interface ScanResult {
    issues: DiagnosticIssue[];
    scannedAt: number;
}

// ─────────────────────────────────────────────
//  DiagnosticsManager
//  — surfaces AI-detected issues as native VS Code
//    diagnostics (red/yellow squiggles + hover cards)
// ─────────────────────────────────────────────

export class DiagnosticsManager {
    // VS Code diagnostic collection shown in Problems panel
    private readonly collection: vscode.DiagnosticCollection;

    // Cache: fsPath → last scan result (avoids redundant API calls)
    private readonly cache = new Map<string, ScanResult>();

    // Debounce handles: fsPath → timer
    private readonly debounceTimers = new Map<string, NodeJS.Timeout>();

    // Quick-fix code-action provider disposable
    private codeActionProvider?: vscode.Disposable;

    // Milliseconds to wait after the last keystroke before scanning
    private readonly DEBOUNCE_MS = 2_500;

    // Only scan files smaller than this (chars) to avoid huge files
    private readonly MAX_FILE_CHARS = 15_000;

    constructor(
        private readonly orchestrator: AgentOrchestrator,
        private readonly memory: AgentMemory,
        private readonly context: vscode.ExtensionContext
    ) {
        this.collection = vscode.languages.createDiagnosticCollection('aiAgent');
        context.subscriptions.push(this.collection);
    }

    // ── Lifecycle ─────────────────────────────────

    /**
     * Start watching the active editor and document changes.
     * Call once from extension activate().
     */
    activate(): void {
        // Scan when the user switches tabs
        this.context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor) { this.scheduleDebounced(editor.document); }
            })
        );

        // Scan on every save (immediate, no debounce needed)
        this.context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(doc => {
                this.clearDebounce(doc.uri.fsPath);
                this.scanDocument(doc);
            })
        );

        // Debounce scan while typing
        this.context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                this.scheduleDebounced(event.document);
            })
        );

        // Clean up cache entry when a file is closed
        this.context.subscriptions.push(
            vscode.workspace.onDidCloseTextDocument(doc => {
                this.cache.delete(doc.uri.fsPath);
                this.collection.delete(doc.uri);
            })
        );

        // Register quick-fix provider for all languages
        this.registerCodeActionProvider();

        // Scan whatever is already open on activation
        if (vscode.window.activeTextEditor) {
            this.scheduleDebounced(vscode.window.activeTextEditor.document);
        }
    }

    // ── Scanning ──────────────────────────────────

    /**
     * Queue a scan with debounce so we don't fire on every keystroke.
     */
    private scheduleDebounced(doc: vscode.TextDocument): void {
        if (!this.shouldScan(doc)) { return; }

        const key = doc.uri.fsPath;
        this.clearDebounce(key);

        const timer = setTimeout(() => {
            this.debounceTimers.delete(key);
            this.scanDocument(doc);
        }, this.DEBOUNCE_MS);

        this.debounceTimers.set(key, timer);
    }

    private clearDebounce(key: string): void {
        const existing = this.debounceTimers.get(key);
        if (existing) {
            clearTimeout(existing);
            this.debounceTimers.delete(key);
        }
    }

    /**
     * Run the AI scan on a single document and publish diagnostics.
     */
    async scanDocument(doc: vscode.TextDocument): Promise<void> {
        if (!this.shouldScan(doc)) { return; }

        const code = doc.getText();

        try {
            const issues = await this.analyzeWithAI(code, doc.languageId, doc.uri.fsPath);

            // Update cache
            this.cache.set(doc.uri.fsPath, {
                issues,
                scannedAt: Date.now(),
            });

            // Convert to VS Code diagnostics and publish
            const diagnostics = issues.map(issue =>
                this.issueToDiagnostic(issue, doc)
            );
            this.collection.set(doc.uri, diagnostics);

        } catch (error: any) {
            // Scan failure is non-fatal — just clear stale diagnostics
            console.error(`[DiagnosticsManager] scan failed: ${error.message}`);
            this.collection.delete(doc.uri);
        }
    }

    /**
     * Force-clear diagnostics for a specific file (e.g. after fix applied).
     */
    clearDiagnostics(uri: vscode.Uri): void {
        this.collection.delete(uri);
        this.cache.delete(uri.fsPath);
    }

    /**
     * Force-clear ALL diagnostics (e.g. when memory is cleared).
     */
    clearAll(): void {
        this.collection.clear();
        this.cache.clear();
    }

    // ── AI analysis ───────────────────────────────

    /**
     * Call the orchestrator for a lightweight diagnostic pass.
     * Returns a structured list of issues.
     */
    private async analyzeWithAI(
        code: string,
        language: string,
        filePath: string
    ): Promise<DiagnosticIssue[]> {

        const prompt = `Analyze the following ${language} code for bugs, errors, and serious issues.
Return ONLY a JSON array — no prose, no markdown fences.
Each element must match this exact shape:
{
  "message":   "<concise description>",
  "severity":  "error"|"warning"|"info"|"hint",
  "line":      <1-based integer>,
  "column":    <1-based integer>,
  "endLine":   <1-based integer>,
  "endColumn": <1-based integer>,
  "code":      "<short-code e.g. AI001>",
  "source":    "AI Agent",
  "fix":       "<optional single-line replacement or empty string>"
}

Rules:
- Report real issues only (no style nitpicks unless severity is "hint")
- line/column must be accurate for the code below
- Return [] if no issues found

Code:
\`\`\`${language}
${code.slice(0, this.MAX_FILE_CHARS)}
\`\`\``;

        const result = await this.orchestrator.execute({
            type: 'analysis',
            input: prompt,
            filePath,
            language,
        });

        return this.parseIssues(result.output);
    }

    // ── Parsing ───────────────────────────────────

    /**
     * Extract the JSON array from the AI response.
     * Tolerant of markdown fences and surrounding prose.
     */
    private parseIssues(raw: string): DiagnosticIssue[] {
        try {
            // Strip optional markdown code fence
            const cleaned = raw
                .replace(/^```[\w]*\n?/m, '')
                .replace(/```$/m, '')
                .trim();

            // Find first '[' to last ']'
            const start = cleaned.indexOf('[');
            const end = cleaned.lastIndexOf(']');
            if (start === -1 || end === -1) { return []; }

            const parsed = JSON.parse(cleaned.slice(start, end + 1));
            if (!Array.isArray(parsed)) { return []; }

            return parsed
                .filter(this.isValidIssue)
                .map(issue => ({
                    ...issue,
                    fix: issue.fix ?? '',
                }));

        } catch {
            return [];
        }
    }

    private isValidIssue(item: unknown): item is DiagnosticIssue {
        if (typeof item !== 'object' || item === null) { return false; }
        const i = item as Record<string, unknown>;
        return (
            typeof i.message === 'string' &&
            typeof i.severity === 'string' &&
            typeof i.line === 'number' &&
            typeof i.column === 'number' &&
            typeof i.endLine === 'number' &&
            typeof i.endColumn === 'number'
        );
    }

    // ── VS Code helpers ───────────────────────────

    /**
     * Convert our DiagnosticIssue → vscode.Diagnostic.
     */
    private issueToDiagnostic(
        issue: DiagnosticIssue,
        doc: vscode.TextDocument
    ): vscode.Diagnostic {
        // Clamp to valid document range
        const lineCount = doc.lineCount;
        const startLine = Math.max(0, Math.min(issue.line - 1, lineCount - 1));
        const endLine = Math.max(0, Math.min(issue.endLine - 1, lineCount - 1));

        const startChar = Math.max(0, issue.column - 1);
        const endChar = Math.max(startChar + 1, issue.endColumn - 1);

        const range = new vscode.Range(startLine, startChar, endLine, endChar);

        const diagnostic = new vscode.Diagnostic(
            range,
            issue.message,
            this.severityMap(issue.severity)
        );

        diagnostic.code = issue.code;
        diagnostic.source = issue.source ?? 'AI Agent';

        // Attach fix text as related information so the code-action
        // provider can pick it up later
        if (issue.fix) {
            diagnostic.relatedInformation = [
                new vscode.DiagnosticRelatedInformation(
                    new vscode.Location(doc.uri, range),
                    `Suggested fix: ${issue.fix}`
                ),
            ];
        }

        return diagnostic;
    }

    private severityMap(s: string): vscode.DiagnosticSeverity {
        switch (s) {
            case 'error': return vscode.DiagnosticSeverity.Error;
            case 'warning': return vscode.DiagnosticSeverity.Warning;
            case 'hint': return vscode.DiagnosticSeverity.Hint;
            default: return vscode.DiagnosticSeverity.Information;
        }
    }

    /**
     * Skip non-code files and very large files.
     */
    private shouldScan(doc: vscode.TextDocument): boolean {
        const ignoredSchemes = new Set(['output', 'debug', 'git', 'search-editor']);
        const supportedLangs = new Set([
            'typescript', 'javascript', 'typescriptreact', 'javascriptreact',
            'python', 'java', 'csharp', 'go', 'rust', 'cpp', 'c',
            'php', 'ruby', 'swift', 'kotlin',
        ]);

        if (ignoredSchemes.has(doc.uri.scheme)) { return false; }
        if (!supportedLangs.has(doc.languageId)) { return false; }
        if (doc.getText().length > this.MAX_FILE_CHARS) { return false; }
        if (doc.isUntitled) { return false; }

        return true;
    }

    // ── Quick-fix code actions ────────────────────

    /**
     * Register a CodeActionProvider so VS Code shows "Quick Fix…"
     * light-bulbs for diagnostics that include a fix string.
     */
    private registerCodeActionProvider(): void {
        this.codeActionProvider = vscode.languages.registerCodeActionsProvider(
            // Apply to all file types
            { scheme: '*' },
            {
                provideCodeActions: (
                    doc: vscode.TextDocument,
                    range: vscode.Range,
                    codeActionContext: vscode.CodeActionContext
                ): vscode.CodeAction[] => {
                    return codeActionContext.diagnostics
                        .filter(d => d.source === 'AI Agent')
                        .flatMap(d => this.buildActions(d, doc, range));
                },
            },
            { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
        );

        this.context.subscriptions.push(this.codeActionProvider);
    }

    /**
     * Build one or two code actions per diagnostic:
     *  1. Apply suggested fix (if available)
     *  2. Explain the issue via AI chat
     */
    private buildActions(
        diagnostic: vscode.Diagnostic,
        doc: vscode.TextDocument,
        _range: vscode.Range
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        // ── Action 1: apply the suggested fix ────────
        const fixText = this.extractFixText(diagnostic);
        if (fixText) {
            const fix = new vscode.CodeAction(
                `🔧 AI Fix: ${diagnostic.message.slice(0, 60)}`,
                vscode.CodeActionKind.QuickFix
            );
            fix.diagnostics = [diagnostic];
            fix.isPreferred = true;
            fix.edit = new vscode.WorkspaceEdit();
            fix.edit.replace(doc.uri, diagnostic.range, fixText);
            actions.push(fix);
        }

        // ── Action 2: open chat with explanation request ─
        const explain = new vscode.CodeAction(
            `💡 Explain with AI Agent`,
            vscode.CodeActionKind.QuickFix
        );
        explain.diagnostics = [diagnostic];
        explain.command = {
            command: 'aiAgent.openChat',
            title: 'Open AI Chat',
            arguments: [`Explain this issue: "${diagnostic.message}" in ${doc.fileName}`],
        };
        actions.push(explain);

        return actions;
    }

    /** Pull fix text from relatedInformation set by issueToDiagnostic(). */
    private extractFixText(diagnostic: vscode.Diagnostic): string | undefined {
        const related = diagnostic.relatedInformation?.[0]?.message ?? '';
        const match = related.match(/^Suggested fix: (.+)$/);
        return match?.[1]?.trim();
    }

    // ── Public utilities ──────────────────────────

    /** Get cached issues for a file path (used by status bar). */
    getCachedIssues(fsPath: string): DiagnosticIssue[] {
        return this.cache.get(fsPath)?.issues ?? [];
    }

    /** Count of current diagnostics across all open files. */
    getTotalDiagnosticCount(): { errors: number; warnings: number } {
        let errors = 0;
        let warnings = 0;

        this.collection.forEach((_uri, diags) => {
            diags.forEach(d => {
                if (d.severity === vscode.DiagnosticSeverity.Error) { errors++; }
                if (d.severity === vscode.DiagnosticSeverity.Warning) { warnings++; }
            });
        });

        return { errors, warnings };
    }
}