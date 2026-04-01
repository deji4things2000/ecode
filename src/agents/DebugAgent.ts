import * as vscode from 'vscode';
import { AgentMemory } from '../core/AgentMemory';
import { ReasoningEngine } from '../core/ReasoningEngine';
import { ToolRegistry } from '../core/ToolRegistry';
import { AIProvider } from '../providers/AIProvider';
import {
    AgentResult,
    AgentTask,
    CodeChange,
} from './AgentOrchestrator';

// ─────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────

interface BugReport {
    id: string;
    severity: BugSeverity;
    category: BugCategory;
    title: string;
    description: string;
    line?: number;
    column?: number;
    snippet?: string;         // offending code fragment
    rootCause: string;
    fix: string;         // prose explanation of the fix
    fixedCode?: string;         // actual replacement code
    prevention: string;         // how to avoid recurrence
    references?: string[];       // links / pattern names
}

type BugSeverity =
    | 'critical'   // data loss, security, crash
    | 'high'       // incorrect behaviour
    | 'medium'     // degraded performance / edge-case failure
    | 'low'        // cosmetic / style
    | 'info';      // suggestion

type BugCategory =
    | 'null-reference'
    | 'logic-error'
    | 'async-error'
    | 'memory-leak'
    | 'security'
    | 'performance'
    | 'type-error'
    | 'resource-leak'
    | 'race-condition'
    | 'error-handling'
    | 'boundary-condition'
    | 'other';

interface DebugSession {
    originalCode: string;
    language: string;
    filePath?: string;
    bugs: BugReport[];
    fixedCode: string;
    toolsUsed: string[];
    diagnostics: string;       // VS Code diagnostic output
    gitContext: string;       // recent diff if available
}

// ─────────────────────────────────────────────
//  DebugAgent
// ─────────────────────────────────────────────

export class DebugAgent {
    constructor(
        private readonly provider: AIProvider,
        private readonly memory: AgentMemory,
        private readonly reasoning: ReasoningEngine,
        private readonly registry: ToolRegistry
    ) { }

    // ─────────────────────────────────────────────
    //  Main entry point
    // ─────────────────────────────────────────────

    async execute(task: AgentTask): Promise<AgentResult> {
        const code = task.context ?? task.input;
        const language = task.language ?? 'unknown';

        // ── Phase 1: gather all available context ────
        const session = await this.buildDebugSession(code, language, task.filePath);

        // ── Phase 2: multi-step reasoning to find bugs ──
        const bugAnalysis = await this.reasoning.reason(
            `Identify every bug, error, and issue in this ${language} code.
Consider: runtime errors, logic errors, async pitfalls, memory leaks,
security vulnerabilities, type errors, and boundary conditions.`,
            this.buildReasoningContext(session),
            4   // up to 4 reasoning steps for thorough analysis
        );

        // ── Phase 3: parse bugs into structured reports ──
        const bugs = await this.extractBugReports(
            bugAnalysis.finalAnswer,
            session.originalCode,
            language
        );

        session.bugs = bugs;

        // ── Phase 4: generate complete fixed code ────
        if (bugs.length > 0) {
            session.fixedCode = await this.generateFixedCode(session);
        } else {
            session.fixedCode = session.originalCode;
        }

        // ── Phase 5: verify the fix looks sound ──────
        const verificationNote = await this.verifyFix(session);

        // ── Phase 6: apply fix to editor if requested ──
        const codeChanges = this.buildCodeChanges(session);

        // ── Phase 7: optionally write fixed file ─────
        if (
            task.filePath &&
            bugs.length > 0 &&
            session.fixedCode !== session.originalCode
        ) {
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
    private async buildDebugSession(
        code: string,
        language: string,
        filePath?: string
    ): Promise<DebugSession> {
        const toolsUsed: string[] = [];
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
                : diffResult.output.slice(0, 2_000);

            if (gitContext) { toolsUsed.push('gitDiff'); }
        }

        // ── If code wasn't provided, read the file ────
        let resolvedCode = code;
        if (!resolvedCode.trim() && filePath) {
            const readResult = await this.registry.execute('readFile', {
                filePath,
                maxChars: 12_000,
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
    private filterDiffForFile(diff: string, filePath: string): string {
        const fileName = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
        const lines = diff.split('\n');
        const relevant: string[] = [];
        let inFile = false;

        for (const line of lines) {
            if (line.startsWith('diff --git')) {
                inFile = line.includes(fileName);
            }
            if (inFile) { relevant.push(line); }
        }

        return relevant.join('\n').slice(0, 2_000);
    }

    // ─────────────────────────────────────────────
    //  Phase 2 — Reasoning context
    // ─────────────────────────────────────────────

    private buildReasoningContext(session: DebugSession): string {
        const parts: string[] = [
            `Language: ${session.language}`,
            `File: ${session.filePath ?? 'unknown'}`,
            '',
            '```' + session.language,
            session.originalCode.slice(0, 10_000),
            '```',
        ];

        if (session.diagnostics) {
            parts.push('', '### Existing VS Code Diagnostics', session.diagnostics);
        }

        if (session.gitContext) {
            parts.push('', '### Recent Git Changes', '```diff', session.gitContext, '```');
        }

        // Inject relevant past debugging memory
        const pastBugs = this.memory.getRelevantMemories(
            `debug ${session.language} bug`,
            3
        );
        if (pastBugs.length) {
            parts.push(
                '',
                '### Relevant Past Debugging Sessions',
                pastBugs.map(m => m.content).join('\n---\n')
            );
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
    private async extractBugReports(
        analysisText: string,
        code: string,
        language: string
    ): Promise<BugReport[]> {

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
            userMessage: `Analysis:\n${analysisText}\n\nOriginal ${language} code:\n\`\`\`\n${code.slice(0, 4_000)}\n\`\`\``,
            temperature: 0.1,   // very low — we need deterministic structured output
            maxTokens: 3_000,
        });

        return this.parseBugReports(response.content);
    }

    private parseBugReports(raw: string): BugReport[] {
        try {
            // Strip any accidental markdown fences
            const cleaned = raw
                .replace(/^```[\w]*\n?/m, '')
                .replace(/```$/m, '')
                .trim();

            const start = cleaned.indexOf('[');
            const end = cleaned.lastIndexOf(']');
            if (start === -1 || end === -1) { return []; }

            const parsed = JSON.parse(cleaned.slice(start, end + 1));
            if (!Array.isArray(parsed)) { return []; }

            return parsed
                .filter(this.isValidBugReport)
                .map((b, idx) => ({
                    ...b,
                    id: b.id ?? `BUG-${String(idx + 1).padStart(3, '0')}`,
                }));

        } catch (err) {
            console.error('[DebugAgent] Failed to parse bug reports:', err);
            return [];
        }
    }

    private isValidBugReport(item: unknown): item is BugReport {
        if (typeof item !== 'object' || item === null) { return false; }
        const b = item as Record<string, unknown>;
        return (
            typeof b.title === 'string' &&
            typeof b.description === 'string' &&
            typeof b.rootCause === 'string' &&
            typeof b.fix === 'string' &&
            typeof b.prevention === 'string'
        );
    }

    // ─────────────────────────────────────────────
    //  Phase 4 — Fix generation
    // ─────────────────────────────────────────────

    /**
     * Generate a single complete fixed version of the entire file.
     * This is more reliable than patching hunks individually.
     */
    private async generateFixedCode(session: DebugSession): Promise<string> {
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
            maxTokens: 4_000,
        });

        return this.extractCodeBlock(response.content) ?? response.content.trim();
    }

    /**
     * Extract the first code block from a markdown-style response,
     * or return the raw content if no fences are present.
     */
    private extractCodeBlock(text: string): string | undefined {
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
    private async verifyFix(session: DebugSession): Promise<string> {
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
                session.fixedCode.slice(0, 4_000),
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

    private buildCodeChanges(session: DebugSession): CodeChange[] {
        const changes: CodeChange[] = [];

        // Whole-file fix
        if (
            session.fixedCode &&
            session.fixedCode !== session.originalCode &&
            session.bugs.length > 0
        ) {
            changes.push({
                description: `Fix ${session.bugs.length} bug(s): ${session.bugs.map(b => b.id).join(', ')
                    }`,
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
    private async offerFileWrite(
        filePath: string,
        fixedCode: string,
        toolsUsed: string[]
    ): Promise<void> {
        const answer = await vscode.window.showInformationMessage(
            '🐛 DebugAgent found and fixed bugs. Apply fixes to file?',
            { modal: false },
            'Apply Fixes',
            'View Only'
        );

        if (answer !== 'Apply Fixes') { return; }

        const writeResult = await this.registry.execute('writeFile', {
            filePath,
            content: fixedCode,
            createDirectories: false,
        });

        if (writeResult.success) {
            toolsUsed.push('writeFile');
            vscode.window.showInformationMessage(
                `✅ Fixes applied to ${filePath.split('/').pop()}`
            );
        } else {
            vscode.window.showErrorMessage(
                `Failed to write fixes: ${writeResult.error}`
            );
        }
    }

    // ─────────────────────────────────────────────
    //  Report builder
    // ─────────────────────────────────────────────

    private buildReport(
        session: DebugSession,
        rawAnalysis: string,
        verificationNote: string
    ): string {
        const lines: string[] = [];

        // ── Header ────────────────────────────────────
        lines.push(
            '# 🐛 Debug Agent Report',
            '',
            this.buildSummaryTable(session),
            ''
        );

        // ── No bugs found ─────────────────────────────
        if (session.bugs.length === 0) {
            lines.push(
                '## ✅ No Bugs Found',
                '',
                rawAnalysis,
                '',
                '> The code passed all automated checks.',
                '',
                '### Recommendations',
                '- Add unit tests to guard against future regressions',
                '- Consider running a static analyser (ESLint / Pylint / Clippy)',
            );
            return lines.join('\n');
        }

        // ── Bug list ──────────────────────────────────
        lines.push('## 🔍 Bugs Found', '');

        // Group by severity
        const bySeverity = this.groupBySeverity(session.bugs);
        const order: BugSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

        for (const sev of order) {
            const group = bySeverity[sev];
            if (!group?.length) { continue; }

            lines.push(`### ${this.severityEmoji(sev)} ${sev.toUpperCase()} (${group.length})`);
            lines.push('');

            for (const bug of group) {
                lines.push(...this.formatBugEntry(bug));
                lines.push('');
            }
        }

        // ── Fixed code ────────────────────────────────
        if (session.fixedCode !== session.originalCode) {
            lines.push(
                '## 🔧 Complete Fixed Code',
                '',
                '```' + session.language,
                session.fixedCode,
                '```',
                ''
            );
        }

        // ── Verification ──────────────────────────────
        lines.push(
            '## ✔️ Fix Verification',
            '',
            verificationNote,
            ''
        );

        // ── Context used ──────────────────────────────
        if (session.diagnostics) {
            lines.push(
                '## 📋 VS Code Diagnostics (at scan time)',
                '',
                '```',
                session.diagnostics,
                '```',
                ''
            );
        }

        if (session.gitContext) {
            lines.push(
                '## 📝 Recent Git Changes',
                '',
                '```diff',
                session.gitContext,
                '```',
                ''
            );
        }

        // ── Tools used ────────────────────────────────
        if (session.toolsUsed.length) {
            lines.push(
                '## 🛠️ Tools Used',
                '',
                session.toolsUsed.map(t => `- \`${t}\``).join('\n'),
                ''
            );
        }

        // ── Prevention guide ──────────────────────────
        lines.push(
            '## 🛡️ Prevention Guide',
            '',
            ...this.buildPreventionGuide(session.bugs)
        );

        return lines.join('\n');
    }

    // ── Report helpers ────────────────────────────

    private buildSummaryTable(session: DebugSession): string {
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

    private formatBugEntry(bug: BugReport): string[] {
        const lines: string[] = [
            `#### \`${bug.id}\` — ${bug.title}`,
            '',
        ];

        if (bug.line) {
            lines.push(`**Location:** Line ${bug.line}${bug.column ? `, Col ${bug.column}` : ''}`);
        }

        lines.push(
            `**Category:** \`${bug.category}\``,
            `**Description:** ${bug.description}`,
            '',
            `**Root Cause:** ${bug.rootCause}`,
            '',
            `**Fix:** ${bug.fix}`,
        );

        if (bug.snippet) {
            lines.push(
                '',
                '**Offending Code:**',
                '```',
                bug.snippet,
                '```'
            );
        }

        if (bug.fixedCode) {
            lines.push(
                '',
                '**Fixed Snippet:**',
                '```',
                bug.fixedCode,
                '```'
            );
        }

        if (bug.references?.length) {
            lines.push(
                '',
                `**References:** ${bug.references.join(' · ')}`
            );
        }

        lines.push(`**Prevention:** ${bug.prevention}`);

        return lines;
    }

    private buildPreventionGuide(bugs: BugReport[]): string[] {
        // De-duplicate prevention tips by category
        const seen = new Set<string>();
        const tips: string[] = [];

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

    private buildSuggestions(bugs: BugReport[]): string[] {
        const suggestions: string[] = [];

        if (bugs.length === 0) {
            suggestions.push('No bugs found — consider adding more test coverage');
            return suggestions;
        }

        const critical = bugs.filter(b => b.severity === 'critical');
        const high = bugs.filter(b => b.severity === 'high');

        if (critical.length) {
            suggestions.push(
                `⛔ ${critical.length} critical bug(s) require immediate attention`
            );
        }
        if (high.length) {
            suggestions.push(
                `🔴 ${high.length} high-severity bug(s) should be fixed before release`
            );
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

    private async persistToMemory(
        task: AgentTask,
        bugs: BugReport[],
        language: string
    ): Promise<void> {
        if (bugs.length === 0) { return; }

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

    private groupBySeverity(bugs: BugReport[]): Record<BugSeverity, BugReport[]> {
        return bugs.reduce((acc, bug) => {
            (acc[bug.severity] ??= []).push(bug);
            return acc;
        }, {} as Record<BugSeverity, BugReport[]>);
    }

    private countBySeverity(bugs: BugReport[]): Record<BugSeverity, number> {
        const counts: Record<BugSeverity, number> = {
            critical: 0, high: 0, medium: 0, low: 0, info: 0,
        };
        bugs.forEach(b => { counts[b.severity] = (counts[b.severity] ?? 0) + 1; });
        return counts;
    }

    private severityEmoji(severity: BugSeverity): string {
        const map: Record<BugSeverity, string> = {
            critical: '🔴',
            high: '🟠',
            medium: '🟡',
            low: '🟢',
            info: 'ℹ️',
        };
        return map[severity] ?? '⚪';
    }
}