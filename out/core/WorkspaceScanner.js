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
exports.WorkspaceScanner = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
// ─────────────────────────────────────────────
//  WorkspaceScanner — builds project-level context
// ─────────────────────────────────────────────
class WorkspaceScanner {
    constructor(memory) {
        this.memory = memory;
    }
    async scanWorkspace() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) {
            return null;
        }
        const rootPath = folders[0].uri.fsPath;
        // Discover files (respect .gitignore patterns via glob excludes)
        const files = await vscode.workspace.findFiles('**/*.{ts,js,py,java,cs,go,rs,cpp,c,jsx,tsx,vue,svelte}', '**/node_modules/**', 200);
        const languages = this.detectLanguages(files);
        const structure = await this.buildStructureTree(files, rootPath);
        const deps = await this.extractDependencies(rootPath);
        const entryPoints = this.findEntryPoints(files, rootPath);
        const ctx = {
            rootPath,
            languages,
            fileCount: files.length,
            structure,
            dependencies: deps,
            entryPoints,
        };
        // Persist to memory for future agent queries
        await this.memory.storeProjectContext(rootPath, this.summarize(ctx), languages[0] ?? 'unknown');
        return ctx;
    }
    // ── Analysis helpers ──────────────────────────
    detectLanguages(files) {
        const extMap = {
            ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript',
            jsx: 'JavaScript', py: 'Python', java: 'Java',
            cs: 'C#', go: 'Go', rs: 'Rust', cpp: 'C++', c: 'C',
            vue: 'Vue', svelte: 'Svelte',
        };
        const counts = {};
        files.forEach(f => {
            const ext = path.extname(f.fsPath).slice(1).toLowerCase();
            const lang = extMap[ext];
            if (lang) {
                counts[lang] = (counts[lang] ?? 0) + 1;
            }
        });
        return Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .map(([lang]) => lang);
    }
    async buildStructureTree(files, rootPath) {
        const dirs = new Set();
        files.forEach(f => {
            const rel = path.relative(rootPath, path.dirname(f.fsPath));
            if (rel && rel !== '.') {
                dirs.add(rel);
            }
        });
        const topLevel = [...dirs]
            .filter(d => !d.includes(path.sep))
            .sort()
            .slice(0, 20);
        return topLevel.length
            ? topLevel.map(d => `  📁 ${d}`).join('\n')
            : '  (flat project)';
    }
    async extractDependencies(rootPath) {
        try {
            const pkgUri = vscode.Uri.file(path.join(rootPath, 'package.json'));
            const raw = await vscode.workspace.fs.readFile(pkgUri);
            const pkg = JSON.parse(Buffer.from(raw).toString('utf8'));
            return Object.keys({
                ...(pkg.dependencies ?? {}),
                ...(pkg.devDependencies ?? {}),
                ...(pkg.peerDependencies ?? {}),
            }).slice(0, 30);
        }
        catch {
            return [];
        }
    }
    findEntryPoints(files, rootPath) {
        const entryPatterns = [
            'index.ts', 'index.js', 'main.ts', 'main.js',
            'app.ts', 'app.js', 'server.ts', 'server.js',
        ];
        return files
            .map(f => path.relative(rootPath, f.fsPath))
            .filter(rel => entryPatterns.includes(path.basename(rel)))
            .slice(0, 5);
    }
    summarize(ctx) {
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
exports.WorkspaceScanner = WorkspaceScanner;
//# sourceMappingURL=WorkspaceScanner.js.map