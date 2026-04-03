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
exports.DebugAgent = void 0;
const vscode = __importStar(require("vscode"));
// ─────────────────────────────────────────────
//  DebugAgent
// ─────────────────────────────────────────────
class DebugAgent {
    constructor(provider, memory, reasoning, registry) {
        this.provider = provider;
        this.memory = memory;
        this.reasoning = reasoning;
        this.registry = registry;
    }
    // ─────────────────────────────────────────────
    //  Main entry point
    // ─────────────────────────────────────────────
    async execute(task) {
        const code = task.context ?? task.input;
        const language = task.language ?? 'unknown';
        // ── Phase 1: gather all available context ────
        const session = await this.buildDebugSession(code, language, task.filePath);
        // ── Phase 2: multi-step reasoning to find bugs ──
        const bugAnalysis = await this.reasoning.reason(`Identify every bug, error, and issue in this ${language} code.
Consider: runtime errors, logic errors, async pitfalls, memory leaks,
security vulnerabilities, type errors, and boundary conditions.`, this.buildReasoningContext(session), 4 // up to 4 reasoning steps for thorough analysis
        );
        // ── Phase 3: parse bugs into structured reports ──
        const bugs = await this.extractBugReports(bugAnalysis.finalAnswer, session.originalCode, language);
        session.bugs = bugs;
        // ── Phase 4: generate complete fixed code ────
        if (bugs.length > 0) {
            session.fixedCode = await this.generateFixedCode(session);
        }
        else {
            session.fixedCode = session.originalCode;
        }
        // ── Phase 5: verify the fix looks sound ──────
        const verificationNote = await this.verifyFix(session);
        // ── Phase 6: apply fix to editor if requested ──
        const codeChanges = this.buildCodeChanges(session);
        // ── Phase 7: optionally write fixed file ─────
        if (task.filePath &&
            bugs.length > 0 &&
            session.fixedCode !== session.originalCode) {
            await this.offerFileWrite(task.filePath, session.fixedCode, session.toolsUsed);
        }
        // ── Build final report ───────────────────────
        const output = this.buildReport(session, bugAnalysis.finalAnswer, verificationNote);
        // ── Persist findings to memory ───────────────
        await this.persistToMemory(task, bugs, language);
        return {
            success: true,
            output,
            agentUsed: 'debugging',
            reasoning: bugAnalysis.steps.map(s => s.thought).join('\n\n'),
            suggestions: this.buildSuggestions(bugs),
            codeChanges,
            toolsUsed: session.toolsUsed,
        };
    }
    // ─────────────────────────────────────────────
    //  Phase 1 — Context gathering
    // ─────────────────────────────────────────────
    /**
     * Uses the ToolRegistry to collect:
     *  - VS Code diagnostics for the file
     *  - Git diff to see what recently changed
     *  - Related memory from past sessions
     */
    async buildDebugSession(code, language, filePath) {
        const toolsUsed = [];
        let diagnostics = '';
        let gitContext = '';
        // ── Fetch existing VS Code diagnostics ────────
        if (filePath) {
            const diagResult = await this.registry.execute('getDiagnostics', {
                filePath,
                severity: 'all',
            });
            if (diagResult.success && diagResult.output !== 'No diagnostics found.') {
                diagnostics = diagResult.output;
                toolsUsed.push('getDiagnostics');
            }
        }
        // ── Fetch git diff for recent changes ─────────
        const diffResult = await this.registry.execute('gitDiff', { staged: false });
        if (diffResult.success && diffResult.output !== '(no output)') {
            // Only keep the portion relevant to this file
            gitContext = filePath
                ? this.filterDiffForFile(diffResult.output, filePath)
                : diffResult.output.slice(0, 2000);
            if (gitContext) {
                toolsUsed.push('gitDiff');
            }
        }
        // ── If code wasn't provided, read the file ────
        let resolvedCode = code;
        if (!resolvedCode.trim() && filePath) {
            const readResult = await this.registry.execute('readFile', {
                filePath,
                maxChars: 12000,
            });
            if (readResult.success) {
                resolvedCode = readResult.output;
                toolsUsed.push('readFile');
            }
        }
        return {
            originalCode: resolvedCode,
            language,
            filePath,
            bugs: [],
            fixedCode: resolvedCode,
            toolsUsed,
            diagnostics,
            gitContext,
        };
    }
    /**
     * Extract only the diff hunks that belong to the target file.
     */
    filterDiffForFile(diff, filePath) {
        const fileName = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
        const lines = diff.split('\n');
        const relevant = [];
        let inFile = false;
        for (const line of lines) {
            if (line.startsWith('diff --git')) {
                inFile = line.includes(fileName);
            }
            if (inFile) {
                relevant.push(line);
            }
        }
        return relevant.join('\n').slice(0, 2000);
    }
    // ─────────────────────────────────────────────
    //  Phase 2 — Reasoning context
    // ─────────────────────────────────────────────
    buildReasoningContext(session) {
        const parts = [
            `Language: ${session.language}`,
            `File: ${session.filePath ?? 'unknown'}`,
            '',
            '```' + session.language,
            session.originalCode.slice(0, 10000),
            '```',
        ];
        if (session.diagnostics) {
            parts.push('', '### Existing VS Code Diagnostics', session.diagnostics);
        }
        if (session.gitContext) {
            parts.push('', '### Recent Git Changes', '```diff', session.gitContext, '```');
        }
        // Inject relevant past debugging memory
        const pastBugs = this.memory.getRelevantMemories(`debug ${session.language} bug`, 3);
        if (pastBugs.length) {
            parts.push('', '### Relevant Past Debugging Sessions', pastBugs.map(m => m.content).join('\n---\n'));
        }
        return parts.join('\n');
    }
    // ─────────────────────────────────────────────
    //  Phase 3 — Bug extraction
    // ─────────────────────────────────────────────
    /**
     * Ask the AI to convert its reasoning output into a structured
     * JSON array of BugReport objects.
     */
    async extractBugReports(analysisText, code, language) {
        const response = await this.provider.complete({
            systemPrompt: `You are a precise bug extraction engine.
Convert the provided analysis into a strict JSON array.
Each element must match this TypeScript interface exactly:

interface BugReport {
  id:          string;          // "BUG-001", "BUG-002", etc.
  severity:    "critical"|"high"|"medium"|"low"|"info";
  category:    "null-reference"|"logic-error"|"async-error"|"memory-leak"|
               "security"|"performance"|"type-error"|"resource-leak"|
               "race-condition"|"error-handling"|"boundary-condition"|"other";
  title:       string;          // ≤10 words
  description: string;          // 1-2 sentences
  line?:       number;          // 1-based, if determinable
  column?:     number;          // 1-based, if determinable
  snippet?:    string;          // the offending code fragment
  rootCause:   string;          // why this bug exists
  fix:         string;          // prose explanation of the fix
  fixedCode?:  string;          // the fixed replacement snippet (just the changed part)
  prevention:  string;          // how to prevent this class of bug
  references?: string[];        // e.g. ["MDN: Promise", "OWASP: SQL Injection"]
}

Return ONLY the JSON array. No markdown, no prose, no fences.
If there are no bugs return [].`,
            userMessage: `Analysis:\n${analysisText}\n\nOriginal ${language} code:\n\`\`\`\n${code.slice(0, 4000)}\n\`\`\``,
            temperature: 0.1, // very low — we need deterministic structured output
            maxTokens: 3000,
        });
        return this.parseBugReports(response.content);
    }
    parseBugReports(raw) {
        try {
            // Strip any accidental markdown fences
            const cleaned = raw
                .replace(/^```[\w]*\n?/m, '')
                .replace(/```$/m, '')
                .trim();
            const start = cleaned.indexOf('[');
            const end = cleaned.lastIndexOf(']');
            if (start === -1 || end === -1) {
                return [];
            }
            const parsed = JSON.parse(cleaned.slice(start, end + 1));
            if (!Array.isArray(parsed)) {
                return [];
            }
            return parsed
                .filter(this.isValidBugReport)
                .map((b, idx) => ({
                ...b,
                id: b.id ?? `BUG-${String(idx + 1).padStart(3, '0')}`,
            }));
        }
        catch (err) {
            console.error('[DebugAgent] Failed to parse bug reports:', err);
            return [];
        }
    }
    isValidBugReport(item) {
        if (typeof item !== 'object' || item === null) {
            return false;
        }
        const b = item;
        return (typeof b.title === 'string' &&
            typeof b.description === 'string' &&
            typeof b.rootCause === 'string' &&
            typeof b.fix === 'string' &&
            typeof b.prevention === 'string');
    }
    // ─────────────────────────────────────────────
    //  Phase 4 — Fix generation
    // ─────────────────────────────────────────────
    /**
     * Generate a single complete fixed version of the entire file.
     * This is more reliable than patching hunks individually.
     */
    async generateFixedCode(session) {
        const bugSummary = session.bugs
            .map(b => `${b.id} [${b.severity.toUpperCase()}] ${b.title}: ${b.fix}`)
            .join('\n');
        const response = await this.provider.complete({
            systemPrompt: `You are an expert ${session.language} developer.
Apply ALL of the listed fixes to the code and return the COMPLETE fixed file.

Rules:
- Fix every bug listed — do not skip any
- Preserve all original functionality not related to the bugs
- Add a short inline comment next to each fix: // fix: <BUG-ID>
- Do NOT add extra features, refactoring, or style changes
- Return ONLY the fixed code — no prose, no markdown fences`,
            userMessage: [
                `Bugs to fix:\n${bugSummary}`,
                '',
                `Original ${session.language} code:`,
                '```' + session.language,
                session.originalCode,
                '```',
            ].join('\n'),
            temperature: 0.15,
            maxTokens: 4000,
        });
        return this.extractCodeBlock(response.content) ?? response.content.trim();
    }
    /**
     * Extract the first code block from a markdown-style response,
     * or return the raw content if no fences are present.
     */
    extractCodeBlock(text) {
        const match = text.match(/```[\w]*\n([\s\S]*?)```/);
        return match?.[1]?.trim();
    }
    // ─────────────────────────────────────────────
    //  Phase 5 — Verification
    // ─────────────────────────────────────────────
    /**
     * Quick sanity-check pass: ask the AI whether the fix introduces
     * new problems or misses any of the reported bugs.
     */
    async verifyFix(session) {
        if (session.bugs.length === 0) {
            return 'No bugs were found — no fix needed.';
        }
        if (session.fixedCode === session.originalCode) {
            return 'Fixed code is identical to original — manual review recommended.';
        }
        const response = await this.provider.complete({
            systemPrompt: `You are a code reviewer performing a fix verification.
Check whether the fixed code:
1. Resolves ALL reported bugs
2. Does NOT introduce new bugs
3. Preserves original logic and functionality

Respond with:
VERIFIED: <yes|partial|no>
NOTES: <brief explanation, max 3 sentences>
REMAINING_ISSUES: <comma-separated BUG-IDs that were not fixed, or "none">`,
            userMessage: [
                'Reported bugs:',
                session.bugs.map(b => `${b.id}: ${b.title}`).join('\n'),
                '',
                'Fixed code:',
                '```' + session.language,
                session.fixedCode.slice(0, 4000),
                '```',
            ].join('\n'),
            temperature: 0.2,
            maxTokens: 400,
        });
        return response.content.trim();
    }
    // ─────────────────────────────────────────────
    //  Phase 6 — Code changes
    // ─────────────────────────────────────────────
    buildCodeChanges(session) {
        const changes = [];
        // Whole-file fix
        if (session.fixedCode &&
            session.fixedCode !== session.originalCode &&
            session.bugs.length > 0) {
            changes.push({
                description: `Fix ${session.bugs.length} bug(s): ${session.bugs.map(b => b.id).join(', ')}`,
                original: session.originalCode,
                improved: session.fixedCode,
            });
        }
        // Individual snippet fixes (for the report UI)
        session.bugs.forEach(bug => {
            if (bug.snippet && bug.fixedCode) {
                changes.push({
                    description: `${bug.id}: ${bug.title}`,
                    original: bug.snippet,
                    improved: bug.fixedCode,
                    line: bug.line,
                });
            }
        });
        return changes;
    }
    // ─────────────────────────────────────────────
    //  Phase 7 — File write
    // ─────────────────────────────────────────────
    /**
     * Offer to write the fixed code back to disk using the ToolRegistry.
     * We ask for confirmation via VS Code modal before writing.
     */
    async offerFileWrite(filePath, fixedCode, toolsUsed) {
        const answer = await vscode.window.showInformationMessage('🐛 DebugAgent found and fixed bugs. Apply fixes to file?', { modal: false }, 'Apply Fixes', 'View Only');
        if (answer !== 'Apply Fixes') {
            return;
        }
        const writeResult = await this.registry.execute('writeFile', {
            filePath,
            content: fixedCode,
            createDirectories: false,
        });
        if (writeResult.success) {
            toolsUsed.push('writeFile');
            vscode.window.showInformationMessage(`✅ Fixes applied to ${filePath.split('/').pop()}`);
        }
        else {
            vscode.window.showErrorMessage(`Failed to write fixes: ${writeResult.error}`);
        }
    }
    // ─────────────────────────────────────────────
    //  Report builder
    // ─────────────────────────────────────────────
    buildReport(session, rawAnalysis, verificationNote) {
        const lines = [];
        // ── Header ────────────────────────────────────
        lines.push('# 🐛 Debug Agent Report', '', this.buildSummaryTable(session), '');
        // ── No bugs found ─────────────────────────────
        if (session.bugs.length === 0) {
            lines.push('## ✅ No Bugs Found', '', rawAnalysis, '', '> The code passed all automated checks.', '', '### Recommendations', '- Add unit tests to guard against future regressions', '- Consider running a static analyser (ESLint / Pylint / Clippy)');
            return lines.join('\n');
        }
        // ── Bug list ──────────────────────────────────
        lines.push('## 🔍 Bugs Found', '');
        // Group by severity
        const bySeverity = this.groupBySeverity(session.bugs);
        const order = ['critical', 'high', 'medium', 'low', 'info'];
        for (const sev of order) {
            const group = bySeverity[sev];
            if (!group?.length) {
                continue;
            }
            lines.push(`### ${this.severityEmoji(sev)} ${sev.toUpperCase()} (${group.length})`);
            lines.push('');
            for (const bug of group) {
                lines.push(...this.formatBugEntry(bug));
                lines.push('');
            }
        }
        // ── Fixed code ────────────────────────────────
        if (session.fixedCode !== session.originalCode) {
            lines.push('## 🔧 Complete Fixed Code', '', '```' + session.language, session.fixedCode, '```', '');
        }
        // ── Verification ──────────────────────────────
        lines.push('## ✔️ Fix Verification', '', verificationNote, '');
        // ── Context used ──────────────────────────────
        if (session.diagnostics) {
            lines.push('## 📋 VS Code Diagnostics (at scan time)', '', '```', session.diagnostics, '```', '');
        }
        if (session.gitContext) {
            lines.push('## 📝 Recent Git Changes', '', '```diff', session.gitContext, '```', '');
        }
        // ── Tools used ────────────────────────────────
        if (session.toolsUsed.length) {
            lines.push('## 🛠️ Tools Used', '', session.toolsUsed.map(t => `- \`${t}\``).join('\n'), '');
        }
        // ── Prevention guide ──────────────────────────
        lines.push('## 🛡️ Prevention Guide', '', ...this.buildPreventionGuide(session.bugs));
        return lines.join('\n');
    }
    // ── Report helpers ────────────────────────────
    buildSummaryTable(session) {
        const counts = this.countBySeverity(session.bugs);
        const rows = [
            `| Metric            | Value |`,
            `|-------------------|-------|`,
            `| Total bugs found  | ${session.bugs.length} |`,
            `| 🔴 Critical       | ${counts.critical} |`,
            `| 🟠 High           | ${counts.high} |`,
            `| 🟡 Medium         | ${counts.medium} |`,
            `| 🟢 Low            | ${counts.low} |`,
            `| ℹ️ Info           | ${counts.info} |`,
            `| Language          | ${session.language} |`,
            `| Tools used        | ${session.toolsUsed.length} |`,
        ];
        return rows.join('\n');
    }
    formatBugEntry(bug) {
        const lines = [
            `#### \`${bug.id}\` — ${bug.title}`,
            '',
        ];
        if (bug.line) {
            lines.push(`**Location:** Line ${bug.line}${bug.column ? `, Col ${bug.column}` : ''}`);
        }
        lines.push(`**Category:** \`${bug.category}\``, `**Description:** ${bug.description}`, '', `**Root Cause:** ${bug.rootCause}`, '', `**Fix:** ${bug.fix}`);
        if (bug.snippet) {
            lines.push('', '**Offending Code:**', '```', bug.snippet, '```');
        }
        if (bug.fixedCode) {
            lines.push('', '**Fixed Snippet:**', '```', bug.fixedCode, '```');
        }
        if (bug.references?.length) {
            lines.push('', `**References:** ${bug.references.join(' · ')}`);
        }
        lines.push(`**Prevention:** ${bug.prevention}`);
        return lines;
    }
    buildPreventionGuide(bugs) {
        // De-duplicate prevention tips by category
        const seen = new Set();
        const tips = [];
        for (const bug of bugs) {
            const key = `${bug.category}:${bug.prevention}`;
            if (!seen.has(key)) {
                seen.add(key);
                tips.push(`- **${bug.category}:** ${bug.prevention}`);
            }
        }
        const general = [
            '',
            '### General Recommendations',
            '- Enable strict mode / strict compiler flags for your language',
            '- Add linting (ESLint, Pylint, Clippy) to your CI pipeline',
            '- Write unit tests for every bug fixed to prevent regression',
            '- Use a code review checklist that covers common bug categories',
        ];
        return [...tips, ...general];
    }
    // ─────────────────────────────────────────────
    //  Suggestions for ChatPanel
    // ─────────────────────────────────────────────
    buildSuggestions(bugs) {
        const suggestions = [];
        if (bugs.length === 0) {
            suggestions.push('No bugs found — consider adding more test coverage');
            return suggestions;
        }
        const critical = bugs.filter(b => b.severity === 'critical');
        const high = bugs.filter(b => b.severity === 'high');
        if (critical.length) {
            suggestions.push(`⛔ ${critical.length} critical bug(s) require immediate attention`);
        }
        if (high.length) {
            suggestions.push(`🔴 ${high.length} high-severity bug(s) should be fixed before release`);
        }
        // Category-specific advice
        const categories = new Set(bugs.map(b => b.category));
        if (categories.has('security')) {
            suggestions.push('Run an OWASP security audit on related endpoints');
        }
        if (categories.has('async-error')) {
            suggestions.push('Add global unhandledRejection / asyncError handlers');
        }
        if (categories.has('memory-leak')) {
            suggestions.push('Profile memory usage with Chrome DevTools or Valgrind');
        }
        if (categories.has('null-reference')) {
            suggestions.push('Enable strict null checks (TypeScript) or use Optional chaining');
        }
        suggestions.push('Write regression tests for each fixed bug');
        return suggestions.slice(0, 6);
    }
    // ─────────────────────────────────────────────
    //  Memory persistence
    // ─────────────────────────────────────────────
    async persistToMemory(task, bugs, language) {
        if (bugs.length === 0) {
            return;
        }
        const summary = [
            `Debugged ${language} file${task.filePath ? ` (${task.filePath.split('/').pop()})` : ''}`,
            `Found ${bugs.length} bug(s):`,
            bugs
                .slice(0, 5)
                .map(b => `  ${b.id} [${b.severity}] ${b.title}`)
                .join('\n'),
        ].join('\n');
        await this.memory.addMemory({
            type: 'codeAnalysis',
            content: summary,
            metadata: {
                timestamp: Date.now(),
                filePath: task.filePath,
                language,
                importance: 8,
                tags: ['debug', 'bugs', language, ...bugs.map(b => b.category)],
            },
        });
    }
    // ─────────────────────────────────────────────
    //  Utility helpers
    // ─────────────────────────────────────────────
    groupBySeverity(bugs) {
        return bugs.reduce((acc, bug) => {
            var _a;
            (acc[_a = bug.severity] ?? (acc[_a] = [])).push(bug);
            return acc;
        }, {});
    }
    countBySeverity(bugs) {
        const counts = {
            critical: 0, high: 0, medium: 0, low: 0, info: 0,
        };
        bugs.forEach(b => { counts[b.severity] = (counts[b.severity] ?? 0) + 1; });
        return counts;
    }
    severityEmoji(severity) {
        const map = {
            critical: '🔴',
            high: '🟠',
            medium: '🟡',
            low: '🟢',
            info: 'ℹ️',
        };
        return map[severity] ?? '⚪';
    }
}
exports.DebugAgent = DebugAgent;
//# sourceMappingURL=DebugAgent.js.map