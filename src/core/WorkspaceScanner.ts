import * as vscode from 'vscode';
import * as path from 'path';
import { AgentMemory } from './AgentMemory';

export interface ProjectContext {
    rootPath: string;
    languages: string[];
    fileCount: number;
    structure: string;     // Human-readable tree
    dependencies: string[];
    entryPoints: string[];
}

// ─────────────────────────────────────────────
//  WorkspaceScanner — builds project-level context
// ─────────────────────────────────────────────

export class WorkspaceScanner {
    constructor(private readonly memory: AgentMemory) { }

    async scanWorkspace(): Promise<ProjectContext | null> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) { return null; }

        const rootPath = folders[0].uri.fsPath;

        // Discover files (respect .gitignore patterns via glob excludes)
        const files = await vscode.workspace.findFiles(
            '**/*.{ts,js,py,java,cs,go,rs,cpp,c,jsx,tsx,vue,svelte}',
            '**/node_modules/**',
            200
        );

        const languages = this.detectLanguages(files);
        const structure = await this.buildStructureTree(files, rootPath);
        const deps = await this.extractDependencies(rootPath);
        const entryPoints = this.findEntryPoints(files, rootPath);

        const ctx: ProjectContext = {
            rootPath,
            languages,
            fileCount: files.length,
            structure,
            dependencies: deps,
            entryPoints,
        };

        // Persist to memory for future agent queries
        await this.memory.storeProjectContext(
            rootPath,
            this.summarize(ctx),
            languages[0] ?? 'unknown'
        );

        return ctx;
    }

    // ── Analysis helpers ──────────────────────────

    private detectLanguages(files: vscode.Uri[]): string[] {
        const extMap: Record<string, string> = {
            ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript',
            jsx: 'JavaScript', py: 'Python', java: 'Java',
            cs: 'C#', go: 'Go', rs: 'Rust', cpp: 'C++', c: 'C',
            vue: 'Vue', svelte: 'Svelte',
        };

        const counts: Record<string, number> = {};
        files.forEach(f => {
            const ext = path.extname(f.fsPath).slice(1).toLowerCase();
            const lang = extMap[ext];
            if (lang) { counts[lang] = (counts[lang] ?? 0) + 1; }
        });

        return Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .map(([lang]) => lang);
    }

    private async buildStructureTree(
        files: vscode.Uri[],
        rootPath: string
    ): Promise<string> {
        const dirs = new Set<string>();
        files.forEach(f => {
            const rel = path.relative(rootPath, path.dirname(f.fsPath));
            if (rel && rel !== '.') { dirs.add(rel); }
        });

        const topLevel = [...dirs]
            .filter(d => !d.includes(path.sep))
            .sort()
            .slice(0, 20);

        return topLevel.length
            ? topLevel.map(d => `  📁 ${d}`).join('\n')
            : '  (flat project)';
    }

    private async extractDependencies(rootPath: string): Promise<string[]> {
        try {
            const pkgUri = vscode.Uri.file(path.join(rootPath, 'package.json'));
            const raw = await vscode.workspace.fs.readFile(pkgUri);
            const pkg = JSON.parse(Buffer.from(raw).toString('utf8'));

            return Object.keys({
                ...(pkg.dependencies ?? {}),
                ...(pkg.devDependencies ?? {}),
                ...(pkg.peerDependencies ?? {}),
            }).slice(0, 30);
        } catch {
            return [];
        }
    }

    private findEntryPoints(files: vscode.Uri[], rootPath: string): string[] {
        const entryPatterns = [
            'index.ts', 'index.js', 'main.ts', 'main.js',
            'app.ts', 'app.js', 'server.ts', 'server.js',
        ];
        return files
            .map(f => path.relative(rootPath, f.fsPath))
            .filter(rel => entryPatterns.includes(path.basename(rel)))
            .slice(0, 5);
    }

    private summarize(ctx: ProjectContext): string {
        return [
            `Project: ${path.basename(ctx.rootPath)}`,
            `Languages: ${ctx.languages.join(', ')}`,
            `Files: ${ctx.fileCount}`,
            `Entry points: ${ctx.entryPoints.join(', ') || 'none detected'}`,
            `Key deps: ${ctx.dependencies.slice(0, 10).join(', ')}`,
            `Structure:\n${ctx.structure}`,
        ].join('\n');
    }
}