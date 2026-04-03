"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentMemory = void 0;
// ─────────────────────────────────────────────
//  AgentMemory — persists context across sessions
// ─────────────────────────────────────────────
class AgentMemory {
    constructor(context, maxItems = 50) {
        this.context = context;
        this.memoryItems = new Map();
        this.conversationHistory = [];
        this.storageKey = 'aiAgent.memory';
        this.maxItems = maxItems;
        this.loadFromStorage();
    }
    // ── Persistence ──────────────────────────────
    loadFromStorage() {
        try {
            const stored = this.context.globalState.get(this.storageKey);
            if (stored) {
                this.memoryItems = new Map(stored.items);
                this.conversationHistory = stored.history ?? [];
            }
        }
        catch {
            // Fresh start — storage corruption is non-fatal
        }
    }
    async saveToStorage() {
        await this.context.globalState.update(this.storageKey, {
            items: Array.from(this.memoryItems.entries()),
            history: this.conversationHistory.slice(-100), // keep last 100 turns
        });
    }
    // ── Memory CRUD ──────────────────────────────
    async addMemory(item) {
        const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        this.memoryItems.set(id, { ...item, id });
        // Evict lowest-importance items when over limit
        if (this.memoryItems.size > this.maxItems) {
            this.evictLowImportance();
        }
        await this.saveToStorage();
    }
    evictLowImportance() {
        const sorted = [...this.memoryItems.values()].sort((a, b) => a.metadata.importance - b.metadata.importance);
        const toRemove = sorted.slice(0, sorted.length - this.maxItems);
        toRemove.forEach(item => this.memoryItems.delete(item.id));
    }
    /** Retrieve top-N relevant memories by tag or keyword matching */
    getRelevantMemories(query, limit = 5) {
        const queryLower = query.toLowerCase();
        const words = queryLower.split(/\s+/);
        return [...this.memoryItems.values()]
            .map(item => ({
            item,
            score: this.scoreRelevance(item, words, queryLower),
        }))
            .filter(({ score }) => score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(({ item }) => item);
    }
    scoreRelevance(item, words, rawQuery) {
        let score = 0;
        const haystack = (item.content + item.metadata.tags.join(' ')).toLowerCase();
        // Direct content match
        if (haystack.includes(rawQuery)) {
            score += 10;
        }
        // Word-by-word matching
        words.forEach(word => {
            if (haystack.includes(word)) {
                score += 2;
            }
        });
        // Recency boost (last 24 h)
        const ageHours = (Date.now() - item.metadata.timestamp) / 3600000;
        if (ageHours < 24) {
            score += 3;
        }
        // Importance weight
        score += item.metadata.importance * 0.5;
        return score;
    }
    // ── Conversation history ──────────────────────
    addConversationTurn(turn) {
        this.conversationHistory.push({ ...turn, timestamp: Date.now() });
    }
    getRecentHistory(turns = 10) {
        return this.conversationHistory.slice(-turns);
    }
    getFormattedHistory(turns = 10) {
        return this.getRecentHistory(turns).map(({ role, content }) => ({
            role,
            content,
        }));
    }
    // ── Project context ───────────────────────────
    async storeProjectContext(filePath, summary, language) {
        await this.addMemory({
            type: 'projectContext',
            content: summary,
            metadata: {
                timestamp: Date.now(),
                filePath,
                language,
                importance: 7,
                tags: ['project', 'context', language],
            },
        });
    }
    getProjectContext() {
        return [...this.memoryItems.values()].filter(item => item.type === 'projectContext');
    }
    // ── Utilities ─────────────────────────────────
    async clearAll() {
        this.memoryItems.clear();
        this.conversationHistory = [];
        await this.saveToStorage();
    }
    getStats() {
        return {
            totalMemories: this.memoryItems.size,
            conversationTurns: this.conversationHistory.length,
            byType: {
                conversation: this.count('conversation'),
                codeAnalysis: this.count('codeAnalysis'),
                userPreference: this.count('userPreference'),
                projectContext: this.count('projectContext'),
            },
        };
    }
    count(type) {
        return [...this.memoryItems.values()].filter(i => i.type === type).length;
    }
}
exports.AgentMemory = AgentMemory;
//# sourceMappingURL=AgentMemory.js.map