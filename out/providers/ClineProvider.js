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
exports.ClineProvider = void 0;
const vscode = __importStar(require("vscode"));
const AIProvider_1 = require("./AIProvider");
const fetch = require('node-fetch');
class ClineProvider extends AIProvider_1.AIProvider {
    constructor(config) {
        super();
        this.config = config;
        this.name = 'cline';
        this.displayName = 'Cline';
        this.description = 'Most popular open-source agent with MCP tool support';
        this.icon = '🔧';
        this.mcpTools = [];
        if (config.mcpServers) {
            this.loadMCPTools(config.mcpServers);
        }
    }
    async complete(req) {
        // ── Try Cline extension API first ────────────
        if (this.config.useClineExtension) {
            const result = await this.tryViaClineExtension(req);
            if (result) {
                return result;
            }
        }
        // ── Inject MCP tool schemas into system prompt ─
        const enhancedSystem = this.mcpTools.length
            ? `${req.systemPrompt}\n\n${this.buildMCPToolPrompt()}`
            : req.systemPrompt;
        // ── Delegate to underlying provider ──────────
        return this.config.delegateProvider.complete({
            ...req,
            systemPrompt: enhancedSystem,
        });
    }
    // ── Cline extension API ───────────────────────
    async tryViaClineExtension(req) {
        try {
            const clineExt = vscode.extensions.getExtension('saoudrizwan.claude-dev');
            if (!clineExt) {
                return null;
            }
            if (!clineExt.isActive) {
                await clineExt.activate();
            }
            const api = clineExt.exports;
            if (!api?.startNewTask) {
                return null;
            }
            // Use Cline's task API for autonomous agent tasks
            const taskId = await api.startNewTask({
                task: req.userMessage,
                configuration: { systemPrompt: req.systemPrompt },
            });
            // Poll for completion (Cline tasks are async)
            const result = await this.pollClineTask(api, taskId, 60000);
            return {
                content: result,
                model: 'cline',
            };
        }
        catch {
            return null; // fall through to delegate provider
        }
    }
    async pollClineTask(api, taskId, timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        const a = api;
        while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 1000));
            const status = await a.getTaskStatus(taskId);
            if (status.status === 'completed') {
                return status.result ?? 'Task completed.';
            }
            if (status.status === 'error') {
                throw new Error('Cline task failed');
            }
        }
        throw new Error('Cline task timed out');
    }
    // ── MCP (Model Context Protocol) ─────────────
    async loadMCPTools(servers) {
        for (const [name, url] of Object.entries(servers)) {
            try {
                const response = await fetch(`${url}/tools/list`, {
                    headers: { 'Content-Type': 'application/json' },
                });
                if (!response.ok) {
                    continue;
                }
                const data = await response.json();
                this.mcpTools.push(...(data.tools ?? []));
                console.log(`[ClineProvider] Loaded ${data.tools?.length ?? 0} tools from MCP server: ${name}`);
            }
            catch (err) {
                console.warn(`[ClineProvider] Could not load MCP server ${name}:`, err);
            }
        }
    }
    async callMCPTool(serverUrl, toolName, args) {
        const response = await fetch(`${serverUrl}/tools/call`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: toolName, arguments: args }),
        });
        if (!response.ok) {
            throw new Error(`MCP tool call failed: ${response.statusText}`);
        }
        return response.json();
    }
    buildMCPToolPrompt() {
        if (!this.mcpTools.length) {
            return '';
        }
        const toolList = this.mcpTools
            .map(t => `- ${t.name}: ${t.description}`)
            .join('\n');
        return [
            'Available MCP Tools (call via tool-use API):',
            toolList,
        ].join('\n');
    }
    getMCPTools() {
        return [...this.mcpTools];
    }
}
exports.ClineProvider = ClineProvider;
//# sourceMappingURL=ClineProvider.js.map