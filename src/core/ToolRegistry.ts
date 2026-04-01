import * as path from 'path';
import * as vscode from 'vscode';
import { ToolRegistry } from '../core/ToolRegistry';

// ─────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────

export interface ToolParameter {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    description: string;
    required: boolean;
    default?: unknown;
    enum?: unknown[];       // allowed values
}

export interface ToolDefinition {
    name: string;
    description: string;
    category: ToolCategory;
    parameters: ToolParameter[];
    execute: (params: ToolParams, context: ToolContext) => Promise<ToolResult>;
}

export interface ToolResult {
    success: boolean;
    output: string;
    data?: unknown;          // structured payload for programmatic consumers
    error?: string;
}

export interface ToolContext {
    workspaceRoot?: string;
    activeFile?: string;
    language?: string;
    vscodeContext: vscode.ExtensionContext;
}

export type ToolParams = Record<string, unknown>;

export type ToolCategory =
    | 'filesystem'
    | 'editor'
    | 'search'
    | 'analysis'
    | 'execution'
    | 'git'
    | 'diagnostics'
    | 'utility';

// Execution record stored in history
interface ToolExecution {
    toolName: string;
    params: ToolParams;
    result: ToolResult;
    timestamp: number;
    durationMs: number;
}

// ─────────────────────────────────────────────
//  ToolRegistry
//  — central catalogue of capabilities available
//    to every agent. Agents call tools instead of
//    writing file I/O / editor manipulation code
//    themselves.
// ─────────────────────────────────────────────

export class ToolRegistry {
    private readonly tools = new Map<string, ToolDefinition>();
    private readonly history: ToolExecution[] = [];
    private toolContext: ToolContext;

    constructor(
        private readonly vscodeContext: vscode.ExtensionContext,
        workspaceRoot?: string
    ) {
        this.toolContext = {
            workspaceRoot,
            vscodeContext,
        };

        this.registerBuiltinTools();
    }

    // ── Context ───────────────────────────────────

    /** Update the runtime context (e.g. when active editor changes). */
    updateContext(partial: Partial<ToolContext>): void {
        this.toolContext = { ...this.toolContext, ...partial };
    }

    // ── Registration ──────────────────────────────

    register(tool: ToolDefinition): void {
        if (this.tools.has(tool.name)) {
            console.warn(`[ToolRegistry] overwriting existing tool: ${tool.name}`);
        }
        this.tools.set(tool.name, tool);
    }

    registerMany(tools: ToolDefinition[]): void {
        tools.forEach(t => this.register(t));
    }

    unregister(name: string): boolean {
        return this.tools.delete(name);
    }

    // ── Execution ─────────────────────────────────

    /**
     * Execute a named tool, record the run in history, and return the result.
     * Throws if the tool is not found.
     */
    async execute(name: string, params: ToolParams = {}): Promise<ToolResult> {
        const tool = this.tools.get(name);
        if (!tool) {
            return {
                success: false,
                output: `Tool "${name}" not found in registry.`,
                error: 'TOOL_NOT_FOUND',
            };
        }

        // Validate required parameters
        const validationError = this.validateParams(tool, params);
        if (validationError) {
            return { success: false, output: validationError, error: 'INVALID_PARAMS' };
        }

        const start = Date.now();
        let result: ToolResult;

        try {
            result = await tool.execute(params, this.toolContext);
        } catch (err: any) {
            result = {
                success: false,
                output: `Tool execution error: ${err.message}`,
                error: err.message,
            };
        }

        this.history.push({
            toolName: name,
            params,
            result,
            timestamp: Date.now(),
            durationMs: Date.now() - start,
        });

        return result;
    }

    /**
     * Execute multiple tools sequentially; stop on first failure
     * unless continueOnError is true.
     */
    async executeChain(
        steps: Array<{ tool: string; params?: ToolParams }>,
        continueOnError = false
    ): Promise<ToolResult[]> {
        const results: ToolResult[] = [];

        for (const step of steps) {
            const result = await this.execute(step.tool, step.params ?? {});
            results.push(result);

            if (!result.success && !continueOnError) {
                break;
            }
        }

        return results;
    }

    // ── Introspection ─────────────────────────────

    getTool(name: string): ToolDefinition | undefined {
        return this.tools.get(name);
    }

    listTools(category?: ToolCategory): ToolDefinition[] {
        const all = [...this.tools.values()];
        return category ? all.filter(t => t.category === category) : all;
    }

    /**
     * Produce a compact schema string for injecting into AI prompts
     * so agents know which tools are available.
     */
    getSchemaForPrompt(category?: ToolCategory): string {
        const tools = this.listTools(category);
        if (!tools.length) { return 'No tools available.'; }

        return tools.map(t => {
            const params = t.parameters
                .map(p => `  - ${p.name} (${p.type}${p.required ? ', required' : ''}): ${p.description}`)
                .join('\n');
            return `TOOL: ${t.name}\nDESCRIPTION: ${t.description}\nPARAMETERS:\n${params || '  (none)'}`;
        }).join('\n\n');
    }

    getHistory(limit = 20): ToolExecution[] {
        return this.history.slice(-limit);
    }

    getStats(): Record<string, unknown> {
        const byCategory: Record<string, number> = {};
        this.tools.forEach(t => {
            byCategory[t.category] = (byCategory[t.category] ?? 0) + 1;
        });

        const successRate = this.history.length
            ? this.history.filter(h => h.result.success).length / this.history.length
            : 1;

        return {
            totalTools: this.tools.size,
            totalRuns: this.history.length,
            successRate: Math.round(successRate * 100) + '%',
            byCategory,
        };
    }

    // ── Validation ────────────────────────────────

    private validateParams(tool: ToolDefinition, params: ToolParams): string | null {
        for (const p of tool.parameters) {
            if (p.required && !(p.name in params)) {
                return `Missing required parameter "${p.name}" for tool "${tool.name}".`;
            }
            if (p.name in params && p.enum && !p.enum.includes(params[p.name])) {
                return `Parameter "${p.name}" must be one of: ${p.enum.join(', ')}.`;
            }
        }
        return null;
    }

    // ══════════════════════════════════════════════
    //  Built-in Tools
    // ══════════════════════════════════════════════

    private registerBuiltinTools(): void {
        this.registerMany([
            // ── Filesystem ──────────────────────────────
            this.toolReadFile(),
            this.toolWriteFile(),
            this.toolListDirectory(),
            this.toolFileExists(),
            this.toolSearchFiles(),

            // ── Editor ──────────────────────────────────
            this.toolGetActiveCode(),
            this.toolInsertCode(),
            this.toolReplaceCode(),
            this.toolOpenFile(),
            this.toolGetCursorPosition(),

            // ── Search ──────────────────────────────────
            this.toolSearchInFiles(),
            this.toolFindSymbol(),

            // ── Analysis ────────────────────────────────
            this.toolGetDiagnostics(),
            this.toolGetFileLanguage(),
            this.toolCountLines(),

            // ── Git ─────────────────────────────────────
            this.toolGitDiff(),
            this.toolGitLog(),
            this.toolGitStatus(),

            // ── Utility ─────────────────────────────────
            this.toolShowMessage(),
            this.toolCopyToClipboard(),
            this.toolGetTimestamp(),
            this.toolFormatCode(),
        ]);
    }

    // ── Filesystem tools ──────────────────────────

    private toolReadFile(): ToolDefinition {
        return {
            name: 'readFile',
            description: 'Read the contents of a file from the workspace',
            category: 'filesystem',
            parameters: [
                {
                    name: 'filePath',
                    type: 'string',
                    description: 'Relative path from workspace root, or absolute path',
                    required: true,
                },
                {
                    name: 'maxChars',
                    type: 'number',
                    description: 'Maximum characters to return (default 10000)',
                    required: false,
                    default: 10_000,
                },
            ],
            execute: async (params, ctx) => {
                try {
                    const filePath = this.resolvePath(params.filePath as string, ctx);
                    const uri = vscode.Uri.file(filePath);
                    const raw = await vscode.workspace.fs.readFile(uri);
                    const content = Buffer.from(raw).toString('utf8');
                    const maxChars = (params.maxChars as number) ?? 10_000;
                    const truncated = content.length > maxChars;

                    return {
                        success: true,
                        output: truncated ? content.slice(0, maxChars) + '\n…[truncated]' : content,
                        data: { filePath, lineCount: content.split('\n').length, truncated },
                    };
                } catch (err: any) {
                    return { success: false, output: '', error: `Cannot read file: ${err.message}` };
                }
            },
        };
    }

    private toolWriteFile(): ToolDefinition {
        return {
            name: 'writeFile',
            description: 'Write or overwrite a file in the workspace',
            category: 'filesystem',
            parameters: [
                {
                    name: 'filePath', type: 'string',
                    description: 'Relative or absolute path to write',
                    required: true,
                },
                {
                    name: 'content', type: 'string',
                    description: 'Content to write',
                    required: true,
                },
                {
                    name: 'createDirectories', type: 'boolean',
                    description: 'Create parent directories if missing (default true)',
                    required: false, default: true,
                },
            ],
            execute: async (params, ctx) => {
                try {
                    const filePath = this.resolvePath(params.filePath as string, ctx);
                    const uri = vscode.Uri.file(filePath);

                    if (params.createDirectories !== false) {
                        const dirUri = vscode.Uri.file(path.dirname(filePath));
                        await vscode.workspace.fs.createDirectory(dirUri);
                    }

                    const bytes = Buffer.from(params.content as string, 'utf8');
                    await vscode.workspace.fs.writeFile(uri, bytes);

                    return {
                        success: true,
                        output: `File written: ${filePath}`,
                        data: { filePath, bytesWritten: bytes.length },
                    };
                } catch (err: any) {
                    return { success: false, output: '', error: `Cannot write file: ${err.message}` };
                }
            },
        };
    }

    private toolListDirectory(): ToolDefinition {
        return {
            name: 'listDirectory',
            description: 'List files and folders inside a directory',
            category: 'filesystem',
            parameters: [
                {
                    name: 'dirPath', type: 'string',
                    description: 'Directory path to list (default: workspace root)',
                    required: false, default: '.',
                },
                {
                    name: 'recursive', type: 'boolean',
                    description: 'List recursively (default false)',
                    required: false, default: false,
                },
            ],
            execute: async (params, ctx) => {
                try {
                    const dirPath = this.resolvePath((params.dirPath as string) ?? '.', ctx);
                    const uri = vscode.Uri.file(dirPath);
                    const entries = await vscode.workspace.fs.readDirectory(uri);

                    const lines = entries
                        .sort((a, b) => {
                            // Directories first
                            if (a[1] !== b[1]) { return a[1] === vscode.FileType.Directory ? -1 : 1; }
                            return a[0].localeCompare(b[0]);
                        })
                        .map(([name, type]) =>
                            type === vscode.FileType.Directory ? `📁 ${name}/` : `📄 ${name}`
                        );

                    return {
                        success: true,
                        output: lines.join('\n') || '(empty directory)',
                        data: { dirPath, count: entries.length },
                    };
                } catch (err: any) {
                    return { success: false, output: '', error: `Cannot list directory: ${err.message}` };
                }
            },
        };
    }

    private toolFileExists(): ToolDefinition {
        return {
            name: 'fileExists',
            description: 'Check whether a file or directory exists',
            category: 'filesystem',
            parameters: [
                {
                    name: 'filePath', type: 'string',
                    description: 'Path to check',
                    required: true,
                },
            ],
            execute: async (params, ctx) => {
                try {
                    const filePath = this.resolvePath(params.filePath as string, ctx);
                    await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
                    return {
                        success: true,
                        output: `Exists: ${filePath}`,
                        data: { exists: true, filePath },
                    };
                } catch {
                    return {
                        success: true,      // not an error — just doesn't exist
                        output: `Does not exist: ${params.filePath}`,
                        data: { exists: false },
                    };
                }
            },
        };
    }

    private toolSearchFiles(): ToolDefinition {
        return {
            name: 'searchFiles',
            description: 'Find files matching a glob pattern in the workspace',
            category: 'filesystem',
            parameters: [
                {
                    name: 'pattern', type: 'string',
                    description: 'Glob pattern e.g. "**/*.ts" or "**/utils/**"',
                    required: true,
                },
                {
                    name: 'exclude', type: 'string',
                    description: 'Exclude pattern (default: node_modules)',
                    required: false, default: '**/node_modules/**',
                },
                {
                    name: 'maxResults', type: 'number',
                    description: 'Maximum results to return (default 50)',
                    required: false, default: 50,
                },
            ],
            execute: async (params) => {
                try {
                    const files = await vscode.workspace.findFiles(
                        params.pattern as string,
                        (params.exclude as string) ?? '**/node_modules/**',
                        (params.maxResults as number) ?? 50
                    );

                    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
                    const lines = files.map(f =>
                        `📄 ${path.relative(root, f.fsPath).replace(/\\/g, '/')}`
                    );

                    return {
                        success: true,
                        output: lines.join('\n') || 'No files matched.',
                        data: { count: files.length, files: lines },
                    };
                } catch (err: any) {
                    return { success: false, output: '', error: err.message };
                }
            },
        };
    }

    // ── Editor tools ──────────────────────────────

    private toolGetActiveCode(): ToolDefinition {
        return {
            name: 'getActiveCode',
            description: 'Get code from the currently active editor (selection or full file)',
            category: 'editor',
            parameters: [
                {
                    name: 'selectionOnly', type: 'boolean',
                    description: 'Return only selected text if true (default false)',
                    required: false, default: false,
                },
            ],
            execute: async (params) => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    return { success: false, output: '', error: 'No active editor.' };
                }

                const useSelection = params.selectionOnly && !editor.selection.isEmpty;
                const code = useSelection
                    ? editor.document.getText(editor.selection)
                    : editor.document.getText();

                return {
                    success: true,
                    output: code,
                    data: {
                        filePath: editor.document.fileName,
                        language: editor.document.languageId,
                        lineCount: editor.document.lineCount,
                        fromSelection: useSelection,
                    },
                };
            },
        };
    }

    private toolInsertCode(): ToolDefinition {
        return {
            name: 'insertCode',
            description: 'Insert code at the cursor position in the active editor',
            category: 'editor',
            parameters: [
                {
                    name: 'code', type: 'string',
                    description: 'Code to insert',
                    required: true,
                },
                {
                    name: 'line', type: 'number',
                    description: 'Line number to insert at (1-based). Defaults to cursor position.',
                    required: false,
                },
            ],
            execute: async (params, _ctx) => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    return { success: false, output: '', error: 'No active editor.' };
                }

                const position = params.line
                    ? new vscode.Position((params.line as number) - 1, 0)
                    : editor.selection.active;

                const edit = new vscode.WorkspaceEdit();
                edit.insert(editor.document.uri, position, params.code as string);
                await vscode.workspace.applyEdit(edit);

                return {
                    success: true,
                    output: `Inserted ${(params.code as string).split('\n').length} line(s) at line ${position.line + 1}.`,
                };
            },
        };
    }

    private toolReplaceCode(): ToolDefinition {
        return {
            name: 'replaceCode',
            description: 'Replace a range of lines in the active editor',
            category: 'editor',
            parameters: [
                {
                    name: 'newCode', type: 'string',
                    description: 'Replacement code',
                    required: true,
                },
                {
                    name: 'startLine', type: 'number',
                    description: 'First line to replace (1-based, default 1)',
                    required: false, default: 1,
                },
                {
                    name: 'endLine', type: 'number',
                    description: 'Last line to replace (1-based, default: last line)',
                    required: false,
                },
            ],
            execute: async (params, _ctx) => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    return { success: false, output: '', error: 'No active editor.' };
                }

                const doc = editor.document;
                const startLine = Math.max(0, ((params.startLine as number) ?? 1) - 1);
                const endLine = params.endLine
                    ? Math.min(doc.lineCount - 1, (params.endLine as number) - 1)
                    : doc.lineCount - 1;

                const range = new vscode.Range(
                    startLine, 0,
                    endLine, doc.lineAt(endLine).text.length
                );

                const edit = new vscode.WorkspaceEdit();
                edit.replace(doc.uri, range, params.newCode as string);
                await vscode.workspace.applyEdit(edit);

                return {
                    success: true,
                    output: `Replaced lines ${startLine + 1}–${endLine + 1}.`,
                    data: { startLine: startLine + 1, endLine: endLine + 1 },
                };
            },
        };
    }

    private toolOpenFile(): ToolDefinition {
        return {
            name: 'openFile',
            description: 'Open a file in the VS Code editor',
            category: 'editor',
            parameters: [
                {
                    name: 'filePath', type: 'string',
                    description: 'File to open',
                    required: true,
                },
                {
                    name: 'column', type: 'number',
                    description: 'View column (1=left, 2=beside). Default 1.',
                    required: false, default: 1,
                },
            ],
            execute: async (params, ctx) => {
                try {
                    const filePath = this.resolvePath(params.filePath as string, ctx);
                    const doc = await vscode.workspace.openTextDocument(filePath);
                    await vscode.window.showTextDocument(
                        doc,
                        (params.column as number) === 2
                            ? vscode.ViewColumn.Beside
                            : vscode.ViewColumn.One
                    );
                    return { success: true, output: `Opened: ${filePath}` };
                } catch (err: any) {
                    return { success: false, output: '', error: err.message };
                }
            },
        };
    }

    private toolGetCursorPosition(): ToolDefinition {
        return {
            name: 'getCursorPosition',
            description: 'Get the current cursor line, column, and surrounding context',
            category: 'editor',
            parameters: [],
            execute: async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    return { success: false, output: '', error: 'No active editor.' };
                }

                const pos = editor.selection.active;
                const doc = editor.document;
                const lineText = doc.lineAt(pos.line).text;

                // Grab 3 lines before and after for context
                const contextStart = Math.max(0, pos.line - 3);
                const contextEnd = Math.min(doc.lineCount - 1, pos.line + 3);
                const contextLines: string[] = [];
                for (let i = contextStart; i <= contextEnd; i++) {
                    const prefix = i === pos.line ? '→ ' : '  ';
                    contextLines.push(`${prefix}${i + 1}: ${doc.lineAt(i).text}`);
                }

                return {
                    success: true,
                    output: [
                        `Line: ${pos.line + 1}, Column: ${pos.character + 1}`,
                        `Current line: ${lineText}`,
                        '',
                        'Context:',
                        contextLines.join('\n'),
                    ].join('\n'),
                    data: {
                        line: pos.line + 1,
                        column: pos.character + 1,
                        lineText,
                    },
                };
            },
        };
    }

    // ── Search tools ──────────────────────────────

    private toolSearchInFiles(): ToolDefinition {
        return {
            name: 'searchInFiles',
            description: 'Search for a text pattern across all workspace files',
            category: 'search',
            parameters: [
                {
                    name: 'query', type: 'string',
                    description: 'Text or regex pattern to search for',
                    required: true,
                },
                {
                    name: 'filePattern', type: 'string',
                    description: 'Glob to restrict search e.g. "**/*.ts"',
                    required: false, default: '**/*',
                },
                {
                    name: 'maxResults', type: 'number',
                    description: 'Maximum matches to return (default 30)',
                    required: false, default: 30,
                },
            ],
            execute: async (params) => {
                try {
                    const results = await vscode.workspace.findTextInFiles(
                        { pattern: params.query as string },
                        {
                            include: params.filePattern as string,
                            exclude: '**/node_modules/**',
                            maxResults: (params.maxResults as number) ?? 30,
                        }
                    );

                    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
                    const lines: string[] = [];
                    let totalMatches = 0;

                    results.forEach((result, uri) => {
                        const relPath = path.relative(root, uri.fsPath).replace(/\\/g, '/');
                        result.results.forEach((match: vscode.TextSearchMatch) => {
                            const lineNum = (match.ranges as vscode.Range[])[0]?.start.line ?? 0;
                            const preview = typeof match.preview.text === 'string'
                                ? match.preview.text.trim().slice(0, 80)
                                : '';
                            lines.push(`${relPath}:${lineNum + 1}  ${preview}`);
                            totalMatches++;
                        });
                    });

                    return {
                        success: true,
                        output: lines.join('\n') || 'No matches found.',
                        data: { totalMatches, filesSearched: results.size },
                    };
                } catch (err: any) {
                    return { success: false, output: '', error: err.message };
                }
            },
        };
    }

    private toolFindSymbol(): ToolDefinition {
        return {
            name: 'findSymbol',
            description: 'Find a function, class, or variable definition in the workspace',
            category: 'search',
            parameters: [
                {
                    name: 'symbolName', type: 'string',
                    description: 'Symbol name to find',
                    required: true,
                },
            ],
            execute: async (params) => {
                try {
                    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                        'vscode.executeWorkspaceSymbolProvider',
                        params.symbolName as string
                    );

                    if (!symbols?.length) {
                        return { success: true, output: `Symbol "${params.symbolName}" not found.`, data: [] };
                    }

                    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
                    const lines = symbols.slice(0, 20).map(s => {
                        const relPath = path.relative(root, s.location.uri.fsPath).replace(/\\/g, '/');
                        const line = s.location.range.start.line + 1;
                        return `${s.kind === vscode.SymbolKind.Function ? '𝑓' : '◆'} ${s.name}  →  ${relPath}:${line}`;
                    });

                    return {
                        success: true,
                        output: lines.join('\n'),
                        data: symbols.slice(0, 20).map(s => ({
                            name: s.name,
                            kind: vscode.SymbolKind[s.kind],
                            file: s.location.uri.fsPath,
                            line: s.location.range.start.line + 1,
                        })),
                    };
                } catch (err: any) {
                    return { success: false, output: '', error: err.message };
                }
            },
        };
    }

    // ── Analysis tools ────────────────────────────

    private toolGetDiagnostics(): ToolDefinition {
        return {
            name: 'getDiagnostics',
            description: 'Get current VS Code diagnostics (errors/warnings) for a file or workspace',
            category: 'diagnostics',
            parameters: [
                {
                    name: 'filePath', type: 'string',
                    description: 'Specific file path, or omit for all open files',
                    required: false,
                },
                {
                    name: 'severity', type: 'string',
                    description: 'Filter by severity: "error" | "warning" | "all" (default "all")',
                    required: false, default: 'all',
                    enum: ['error', 'warning', 'all'],
                },
            ],
            execute: async (params, ctx) => {
                let diagnostics: Array<[vscode.Uri, readonly vscode.Diagnostic[]]>;

                if (params.filePath) {
                    const filePath = this.resolvePath(params.filePath as string, ctx);
                    const uri = vscode.Uri.file(filePath);
                    diagnostics = [[uri, vscode.languages.getDiagnostics(uri)]];
                } else {
                    diagnostics = vscode.languages.getDiagnostics();
                }

                const severityFilter = (params.severity as string) ?? 'all';
                const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
                const lines: string[] = [];
                let total = 0;

                diagnostics.forEach(([uri, diags]) => {
                    const filtered = diags.filter(d => {
                        if (severityFilter === 'error') { return d.severity === vscode.DiagnosticSeverity.Error; }
                        if (severityFilter === 'warning') { return d.severity === vscode.DiagnosticSeverity.Warning; }
                        return true;
                    });

                    filtered.forEach(d => {
                        const relPath = path.relative(root, uri.fsPath).replace(/\\/g, '/');
                        const sev = vscode.DiagnosticSeverity[d.severity];
                        lines.push(`[${sev}] ${relPath}:${d.range.start.line + 1} — ${d.message}`);
                        total++;
                    });
                });

                return {
                    success: true,
                    output: lines.join('\n') || 'No diagnostics found.',
                    data: { total },
                };
            },
        };
    }

    private toolGetFileLanguage(): ToolDefinition {
        return {
            name: 'getFileLanguage',
            description: 'Detect the programming language of a file',
            category: 'analysis',
            parameters: [
                {
                    name: 'filePath', type: 'string',
                    description: 'File path to check (defaults to active editor)',
                    required: false,
                },
            ],
            execute: async (params, ctx) => {
                try {
                    if (params.filePath) {
                        const filePath = this.resolvePath(params.filePath as string, ctx);
                        const doc = await vscode.workspace.openTextDocument(filePath);
                        return {
                            success: true,
                            output: doc.languageId,
                            data: { language: doc.languageId, filePath },
                        };
                    }

                    const editor = vscode.window.activeTextEditor;
                    if (!editor) { return { success: false, output: '', error: 'No active editor.' }; }

                    return {
                        success: true,
                        output: editor.document.languageId,
                        data: { language: editor.document.languageId },
                    };
                } catch (err: any) {
                    return { success: false, output: '', error: err.message };
                }
            },
        };
    }

    private toolCountLines(): ToolDefinition {
        return {
            name: 'countLines',
            description: 'Count lines of code in a file or directory',
            category: 'analysis',
            parameters: [
                {
                    name: 'target', type: 'string',
                    description: 'File or directory path',
                    required: true,
                },
            ],
            execute: async (params, ctx) => {
                try {
                    const target = this.resolvePath(params.target as string, ctx);
                    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(target));

                    if (stat.type === vscode.FileType.File) {
                        const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(target));
                        const lines = Buffer.from(raw).toString('utf8').split('\n').length;
                        return {
                            success: true,
                            output: `${lines} lines in ${path.basename(target)}`,
                            data: { lines, filePath: target },
                        };
                    }

                    // Directory: aggregate
                    const files = await vscode.workspace.findFiles(
                        new vscode.RelativePattern(target, '**/*.{ts,js,py,java,cs,go,rs}'),
                        '**/node_modules/**',
                        500
                    );

                    let total = 0;
                    await Promise.all(files.map(async f => {
                        const raw = await vscode.workspace.fs.readFile(f);
                        total += Buffer.from(raw).toString('utf8').split('\n').length;
                    }));

                    return {
                        success: true,
                        output: `${total} total lines across ${files.length} files`,
                        data: { total, fileCount: files.length },
                    };
                } catch (err: any) {
                    return { success: false, output: '', error: err.message };
                }
            },
        };
    }

    // ── Git tools ─────────────────────────────────

    private toolGitDiff(): ToolDefinition {
        return {
            name: 'gitDiff',
            description: 'Get the current git diff (staged or unstaged)',
            category: 'git',
            parameters: [
                {
                    name: 'staged', type: 'boolean',
                    description: 'Show staged diff (default false = unstaged)',
                    required: false, default: false,
                },
            ],
            execute: async (params, ctx) => {
                return this.runGitCommand(
                    params.staged ? 'git diff --cached' : 'git diff',
                    ctx.workspaceRoot
                );
            },
        };
    }

    private toolGitLog(): ToolDefinition {
        return {
            name: 'gitLog',
            description: 'Get recent git commit history',
            category: 'git',
            parameters: [
                {
                    name: 'limit', type: 'number',
                    description: 'Number of commits to return (default 10)',
                    required: false, default: 10,
                },
            ],
            execute: async (params, ctx) => {
                const limit = (params.limit as number) ?? 10;
                return this.runGitCommand(
                    `git log --oneline --no-merges -${limit}`,
                    ctx.workspaceRoot
                );
            },
        };
    }

    private toolGitStatus(): ToolDefinition {
        return {
            name: 'gitStatus',
            description: 'Get the current git status',
            category: 'git',
            parameters: [],
            execute: async (_params, ctx) => {
                return this.runGitCommand('git status --short', ctx.workspaceRoot);
            },
        };
    }

    // ── Utility tools ─────────────────────────────

    private toolShowMessage(): ToolDefinition {
        return {
            name: 'showMessage',
            description: 'Show an information, warning, or error message to the user',
            category: 'utility',
            parameters: [
                {
                    name: 'message', type: 'string',
                    description: 'Message text',
                    required: true,
                },
                {
                    name: 'type', type: 'string',
                    description: 'Message type: "info" | "warning" | "error"',
                    required: false, default: 'info',
                    enum: ['info', 'warning', 'error'],
                },
            ],
            execute: async (params) => {
                const msg = params.message as string;
                const type = (params.type as string) ?? 'info';

                if (type === 'error') { vscode.window.showErrorMessage(msg); }
                else if (type === 'warning') { vscode.window.showWarningMessage(msg); }
                else { vscode.window.showInformationMessage(msg); }

                return { success: true, output: `Displayed ${type}: ${msg}` };
            },
        };
    }

    private toolCopyToClipboard(): ToolDefinition {
        return {
            name: 'copyToClipboard',
            description: 'Copy text to the system clipboard',
            category: 'utility',
            parameters: [
                {
                    name: 'text', type: 'string',
                    description: 'Text to copy',
                    required: true,
                },
            ],
            execute: async (params) => {
                await vscode.env.clipboard.writeText(params.text as string);
                return {
                    success: true,
                    output: `Copied ${(params.text as string).length} characters to clipboard.`,
                };
            },
        };
    }

    private toolGetTimestamp(): ToolDefinition {
        return {
            name: 'getTimestamp',
            description: 'Get the current date and time in various formats',
            category: 'utility',
            parameters: [
                {
                    name: 'format', type: 'string',
                    description: '"iso" | "unix" | "human" (default "iso")',
                    required: false, default: 'iso',
                    enum: ['iso', 'unix', 'human'],
                },
            ],
            execute: async (params) => {
                const now = new Date();
                const format = (params.format as string) ?? 'iso';
                let output: string;

                switch (format) {
                    case 'unix': output = String(Math.floor(now.getTime() / 1000)); break;
                    case 'human': output = now.toLocaleString(); break;
                    default: output = now.toISOString();
                }

                return { success: true, output, data: { timestamp: output, format } };
            },
        };
    }

    private toolFormatCode(): ToolDefinition {
        return {
            name: 'formatCode',
            description: 'Trigger VS Code formatter on the active file',
            category: 'utility',
            parameters: [
                {
                    name: 'selectionOnly', type: 'boolean',
                    description: 'Format only selected text (default false)',
                    required: false, default: false,
                },
            ],
            execute: async (params) => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    return { success: false, output: '', error: 'No active editor.' };
                }

                const command = params.selectionOnly && !editor.selection.isEmpty
                    ? 'editor.action.formatSelection'
                    : 'editor.action.formatDocument';

                await vscode.commands.executeCommand(command);
                return { success: true, output: 'Formatting applied.' };
            },
        };
    }

    // ── Internal helpers ──────────────────────────

    /**
     * Resolve a path to absolute, anchored at workspace root when relative.
     */
    private resolvePath(filePath: string, ctx: ToolContext): string {
        if (path.isAbsolute(filePath)) { return filePath; }
        const root = ctx.workspaceRoot
            ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
            ?? process.cwd();
        return path.resolve(root, filePath);
    }

    /**
     * Run a git shell command and return its stdout as a ToolResult.
     * Uses VS Code's terminal API to stay cross-platform.
     */
    private async runGitCommand(
        command: string,
        cwd?: string
    ): Promise<ToolResult> {
        return new Promise(resolve => {
            const { exec } = require('child_process');
            exec(command, { cwd: cwd ?? process.cwd() }, (err: Error | null, stdout: string, stderr: string) => {
                if (err) {
                    resolve({
                        success: false,
                        output: stderr || err.message,
                        error: err.message,
                    });
                } else {
                    resolve({
                        success: true,
                        output: stdout.trim() || '(no output)',
                    });
                }
            });
        });
    }
}