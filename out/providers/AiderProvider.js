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
exports.AiderProvider = void 0;
const vscode = __importStar(require("vscode"));
const AIProvider_1 = require("./AIProvider");
class AiderProvider extends AIProvider_1.AIProvider {
    constructor(config) {
        super();
        this.config = config;
        this.name = 'aider';
        this.displayName = 'Aider';
        this.description = 'Git-integrated AI coding with cost optimization';
        this.icon = '🔀';
    }
    async complete(req) {
        // For chat-style queries delegate to the underlying provider
        // (Aider's strength is file editing, not chat)
        return this.config.delegateProvider.complete(req);
    }
    // ── Aider-specific: edit files via CLI ────────
    /**
     * Run an Aider edit task in a VS Code terminal.
     * Aider reads the message, edits the relevant files,
     * and commits the changes to git automatically.
     */
    async editWithAider(message, files, workspaceRoot) {
        const terminal = vscode.window.createTerminal({
            name: '🔀 Aider',
            cwd: workspaceRoot,
        });
        terminal.show();
        const flags = this.buildFlags(files);
        const safeMsg = message.replace(/"/g, '\\"');
        // Run aider in non-interactive mode with the message
        terminal.sendText(`${this.config.aiderPath ?? 'aider'} ${flags} --message "${safeMsg}"`);
    }
    /**
     * Start an interactive Aider session in a terminal.
     * User can then chat with Aider directly.
     */
    async startInteractiveSession(files, workspaceRoot) {
        const terminal = vscode.window.createTerminal({
            name: '🔀 Aider (Interactive)',
            cwd: workspaceRoot,
        });
        terminal.show();
        const flags = this.buildFlags(files);
        terminal.sendText(`${this.config.aiderPath ?? 'aider'} ${flags}`);
        return terminal;
    }
    /**
     * Generate an Aider-style SEARCH/REPLACE edit block.
     * This is the format Aider uses internally for precise edits.
     */
    async generateEditBlock(filePath, instruction) {
        const response = await this.config.delegateProvider.complete({
            systemPrompt: `You are generating an Aider SEARCH/REPLACE edit block.
Format your response EXACTLY like this — no other text:

path/to/file.ts
\`\`\`typescript
<<<<<<< SEARCH
<exact lines to find>
=======
<replacement lines>
>>>>>>> REPLACE
\`\`\`

Rules:
- SEARCH must match the original file exactly (whitespace included)
- Only include the minimal lines needed for the change
- You may include multiple SEARCH/REPLACE blocks for the same file`,
            userMessage: `File: ${filePath}\nInstruction: ${instruction}`,
            temperature: 0.1,
            maxTokens: 2000,
        });
        return response.content;
    }
    /** Estimate the cost of a request in USD */
    estimateCost(promptTokens, completionTokens, model) {
        // Pricing per 1M tokens (approximate, as of 2024)
        const pricing = {
            'gpt-4o': { input: 5.00, output: 15.00 },
            'gpt-4': { input: 30.00, output: 60.00 },
            'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
            'claude-3-5-sonnet': { input: 3.00, output: 15.00 },
            'claude-3-opus': { input: 15.00, output: 75.00 },
        };
        const key = Object.keys(pricing).find(k => model.includes(k)) ?? 'gpt-4o';
        const rates = pricing[key];
        return ((promptTokens / 1000000) * rates.input +
            (completionTokens / 1000000) * rates.output);
    }
    // ── Helpers ───────────────────────────────────
    buildFlags(files) {
        const parts = [];
        if (this.config.autoCommits === false) {
            parts.push('--no-auto-commits');
        }
        if (this.config.extraFlags?.length) {
            parts.push(...this.config.extraFlags);
        }
        // Add files to edit
        files.forEach(f => parts.push(`"${f}"`));
        return parts.join(' ');
    }
}
exports.AiderProvider = AiderProvider;
//# sourceMappingURL=AiderProvider.js.map