"use strict";
// ─────────────────────────────────────────────
//  Shared types and abstract base
// ─────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIProvider = void 0;
class AIProvider {
    /** Quick helper — wraps complete() with a single-shot prompt */
    async ask(prompt, system) {
        const res = await this.complete({
            systemPrompt: system ?? 'You are a helpful AI coding assistant.',
            userMessage: prompt,
        });
        return res.content;
    }
}
exports.AIProvider = AIProvider;
//# sourceMappingURL=AIProvider.js.map