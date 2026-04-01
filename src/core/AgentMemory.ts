import * as vscode from 'vscode';

// ─────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────

export interface MemoryItem {
    id: string;
    type: 'conversation' | 'codeAnalysis' | 'userPreference' | 'projectContext';
    content: string;
    metadata: {
        timestamp: number;
        filePath?: string;
        language?: string;
        importance: number;       // 1-10 scale for retrieval priority
        tags: string[];
    };
}

export interface ConversationTurn {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    agentType?: string;
}

// ─────────────────────────────────────────────
//  AgentMemory — persists context across sessions
// ─────────────────────────────────────────────

export class AgentMemory {
    private memoryItems: Map<string, MemoryItem> = new Map();
    private conversationHistory: ConversationTurn[] = [];
    private readonly maxItems: number;
    private readonly storageKey = 'aiAgent.memory';

    constructor(
        private readonly context: vscode.ExtensionContext,
        maxItems = 50
    ) {
        this.maxItems = maxItems;
        this.loadFromStorage();
    }

    // ── Persistence ──────────────────────────────

    private loadFromStorage(): void {
        try {
            const stored = this.context.globalState.get<{
                items: [string, MemoryItem][];
                history: ConversationTurn[];
            }>(this.storageKey);

            if (stored) {
                this.memoryItems = new Map(stored.items);
                this.conversationHistory = stored.history ?? [];
            }
        } catch {
            // Fresh start — storage corruption is non-fatal
        }
    }

    private async saveToStorage(): Promise<void> {
        await this.context.globalState.update(this.storageKey, {
            items: Array.from(this.memoryItems.entries()),
            history: this.conversationHistory.slice(-100),  // keep last 100 turns
        });
    }

    // ── Memory CRUD ──────────────────────────────

    async addMemory(item: Omit<MemoryItem, 'id'>): Promise<void> {
        const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        this.memoryItems.set(id, { ...item, id });

        // Evict lowest-importance items when over limit
        if (this.memoryItems.size > this.maxItems) {
            this.evictLowImportance();
        }

        await this.saveToStorage();
    }

    private evictLowImportance(): void {
        const sorted = [...this.memoryItems.values()].sort(
            (a, b) => a.metadata.importance - b.metadata.importance
        );
        const toRemove = sorted.slice(0, sorted.length - this.maxItems);
        toRemove.forEach(item => this.memoryItems.delete(item.id));
    }

    /** Retrieve top-N relevant memories by tag or keyword matching */
    getRelevantMemories(query: string, limit = 5): MemoryItem[] {
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

    private scoreRelevance(
        item: MemoryItem,
        words: string[],
        rawQuery: string
    ): number {
        let score = 0;
        const haystack = (item.content + item.metadata.tags.join(' ')).toLowerCase();

        // Direct content match
        if (haystack.includes(rawQuery)) { score += 10; }

        // Word-by-word matching
        words.forEach(word => {
            if (haystack.includes(word)) { score += 2; }
        });

        // Recency boost (last 24 h)
        const ageHours = (Date.now() - item.metadata.timestamp) / 3_600_000;
        if (ageHours < 24) { score += 3; }

        // Importance weight
        score += item.metadata.importance * 0.5;

        return score;
    }

    // ── Conversation history ──────────────────────

    addConversationTurn(turn: Omit<ConversationTurn, 'timestamp'>): void {
        this.conversationHistory.push({ ...turn, timestamp: Date.now() });
    }

    getRecentHistory(turns = 10): ConversationTurn[] {
        return this.conversationHistory.slice(-turns);
    }

    getFormattedHistory(turns = 10): Array<{ role: string; content: string }> {
        return this.getRecentHistory(turns).map(({ role, content }) => ({
            role,
            content,
        }));
    }

    // ── Project context ───────────────────────────

    async storeProjectContext(
        filePath: string,
        summary: string,
        language: string
    ): Promise<void> {
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

    getProjectContext(): MemoryItem[] {
        return [...this.memoryItems.values()].filter(
            item => item.type === 'projectContext'
        );
    }

    // ── Utilities ─────────────────────────────────

    async clearAll(): Promise<void> {
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

    private count(type: MemoryItem['type']): number {
        return [...this.memoryItems.values()].filter(i => i.type === type).length;
    }
}