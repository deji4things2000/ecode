/* ════════════════════════════════════════════
   chat.js — AI Agent WebView frontend
   ════════════════════════════════════════════ */

(function () {
    'use strict';

    // ── VS Code API ───────────────────────────────
    const vscode = acquireVsCodeApi();

    // ── DOM refs ──────────────────────────────────
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const charCount = document.getElementById('charCount');
    const inputHint = document.getElementById('inputHint');
    const agentLabel = document.getElementById('agentLabel');
    const chipsEl = document.getElementById('chips');
    const welcomeCard = document.getElementById('welcomeCard');
    const statsOverlay = document.getElementById('statsOverlay');
    const toolsOverlay = document.getElementById('toolsOverlay');
    const statsBody = document.getElementById('statsBody');
    const toolGrid = document.getElementById('toolGrid');
    const confirmBack = document.getElementById('confirmBackdrop');
    const confirmMsg = document.getElementById('confirmMsg');
    const confirmYes = document.getElementById('confirmYes');
    const confirmNo = document.getElementById('confirmNo');

    // ── State ─────────────────────────────────────
    let activeAgent = 'general';
    let thinkingEl = null;
    let isSending = false;
    let confirmResolve = null;

    const MAX_CHARS = 4_000;
    const AGENT_LABELS = {
        general: 'General Agent',
        analysis: 'Code Analysis Agent',
        debugging: 'Debug Agent',
        refactoring: 'Refactoring Agent',
        testing: 'Test Generation Agent',
        architecture: 'Architecture Agent',
    };

    const TOOL_CATALOGUE = [
        { name: 'readFile', icon: '📄', category: 'filesystem' },
        { name: 'writeFile', icon: '💾', category: 'filesystem' },
        { name: 'listDirectory', icon: '📁', category: 'filesystem' },
        { name: 'searchFiles', icon: '🔍', category: 'filesystem' },
        { name: 'getActiveCode', icon: '✏️', category: 'editor' },
        { name: 'getDiagnostics', icon: '🩺', category: 'diagnostics' },
        { name: 'searchInFiles', icon: '🔎', category: 'search' },
        { name: 'findSymbol', icon: '🔗', category: 'search' },
        { name: 'gitStatus', icon: '📋', category: 'git' },
        { name: 'gitDiff', icon: '📝', category: 'git' },
        { name: 'gitLog', icon: '📜', category: 'git' },
        { name: 'countLines', icon: '🔢', category: 'analysis' },
        { name: 'getTimestamp', icon: '🕐', category: 'utility' },
        { name: 'formatCode', icon: '✨', category: 'utility' },
    ];

    // ════════════════════════════════════════════
    //  Initialisation
    // ════════════════════════════════════════════

    function init() {
        bindEventListeners();
        renderToolGrid();
        inputEl.focus();
    }

    // ════════════════════════════════════════════
    //  Event listeners
    // ════════════════════════════════════════════

    function bindEventListeners() {
        // ── Send ──────────────────────────────────────
        sendBtn.addEventListener('click', handleSend);

        inputEl.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            }
        });

        inputEl.addEventListener('input', () => {
            autoResizeTextarea();
            updateCharCount();
        });

        // ── Attach (use active editor code) ──────────
        document.getElementById('attachBtn').addEventListener('click', () => {
            const prefix = `[Using active editor code]\n`;
            if (!inputEl.value.startsWith(prefix)) {
                inputEl.value = prefix + inputEl.value;
                autoResizeTextarea();
                updateCharCount();
            }
            inputEl.focus();
        });

        // ── Header buttons ────────────────────────────
        document.getElementById('statsBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'getAgentStats' });
            openOverlay('statsOverlay');
        });

        document.getElementById('toolsBtn').addEventListener('click', () => {
            openOverlay('toolsOverlay');
        });

        document.getElementById('clearBtn').addEventListener('click', async () => {
            const confirmed = await confirm('Clear all chat messages and agent memory?');
            if (confirmed) {
                vscode.postMessage({ command: 'clearChat' });
            }
        });

        document.getElementById('settingsBtn').addEventListener('click', () => {
            vscode.postMessage({
                command: 'runTool', tool: 'showMessage',
                params: { message: 'Open VS Code settings and search "aiAgent" to configure.', type: 'info' }
            });
        });

        // ── Agent tabs ────────────────────────────────
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => {
                    t.classList.remove('active');
                    t.setAttribute('aria-selected', 'false');
                });
                tab.classList.add('active');
                tab.setAttribute('aria-selected', 'true');
                activeAgent = tab.dataset.agent;
                agentLabel.textContent = AGENT_LABELS[activeAgent] ?? 'Agent';
                inputEl.placeholder = agentHint(activeAgent);
                inputEl.focus();
            });
        });

        // ── Overlay close buttons ─────────────────────
        document.querySelectorAll('.close-overlay').forEach(btn => {
            btn.addEventListener('click', () => closeOverlay(btn.dataset.target));
        });

        // Click backdrop to close
        [statsOverlay, toolsOverlay].forEach(overlay => {
            overlay.addEventListener('click', e => {
                if (e.target === overlay) { closeOverlay(overlay.id); }
            });
        });

        // ── Confirm dialog ────────────────────────────
        confirmYes.addEventListener('click', () => resolveConfirm(true));
        confirmNo.addEventListener('click', () => resolveConfirm(false));
        confirmBack.addEventListener('click', e => {
            if (e.target === confirmBack) { resolveConfirm(false); }
        });

        // ── Escape key ────────────────────────────────
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                closeOverlay('statsOverlay');
                closeOverlay('toolsOverlay');
                resolveConfirm(false);
            }
        });
    }

    // ════════════════════════════════════════════
    //  Sending messages
    // ════════════════════════════════════════════

    function handleSend() {
        const text = inputEl.value.trim();
        if (!text || isSending) { return; }

        // Dismiss welcome card on first message
        if (welcomeCard) { welcomeCard.remove(); }

        // Prepend agent directive when non-general tab is active
        const fullText = activeAgent !== 'general'
            ? `[${activeAgent}] ${text}`
            : text;

        appendUserMessage(text);
        clearChips();

        vscode.postMessage({ command: 'sendMessage', text: fullText });

        inputEl.value = '';
        autoResizeTextarea();
        updateCharCount();
        setSending(true);
    }

    function setSending(sending) {
        isSending = sending;
        sendBtn.disabled = sending;
        inputEl.disabled = sending;
    }

    // ════════════════════════════════════════════
    //  Message receiving (from extension)
    // ════════════════════════════════════════════

    window.addEventListener('message', event => {
        const msg = event.data;
        switch (msg.command) {
            case 'showThinking': showThinking(); break;
            case 'receiveMessage': onReceiveMessage(msg.message); break;
            case 'chatCleared': onChatCleared(); break;
            case 'memoryStats': renderMemoryStats(msg.stats); break;
            case 'agentStats': renderAgentStats(msg.stats); break;
            case 'toolResult': onToolResult(msg.tool, msg.result); break;
        }
    });

    function onReceiveMessage(msg) {
        hideThinking();
        setSending(false);
        appendAssistantMessage(msg);
        showSuggestionChips(msg.suggestions ?? []);
    }

    function onChatCleared() {
        messagesEl.innerHTML = '';
        clearChips();
        appendSystemNotice('🧹 Chat cleared — memory reset.');
    }

    function onToolResult(toolName, result) {
        const content = result.success
            ? `**Tool \`${toolName}\` result:**\n\n${result.output}`
            : `**Tool \`${toolName}\` failed:** ${result.error}`;

        appendAssistantMessage({
            role: 'assistant',
            content,
            agentUsed: 'general',
            timestamp: Date.now(),
        });
    }

    // ════════════════════════════════════════════
    //  DOM — append messages
    // ════════════════════════════════════════════

    function appendUserMessage(text) {
        const wrapper = document.createElement('div');
        wrapper.className = 'message user';

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.textContent = text;

        const ts = document.createElement('div');
        ts.className = 'message-timestamp';
        ts.textContent = formatTime(Date.now());

        wrapper.appendChild(bubble);
        wrapper.appendChild(ts);
        messagesEl.appendChild(wrapper);
        scrollToBottom();
    }

    function appendAssistantMessage(msg) {
        const wrapper = document.createElement('div');
        wrapper.className = `message assistant${msg.isError ? ' error' : ''}`;

        // ── Agent badge ────────────────────────────────
        if (msg.agentUsed) {
            const badge = document.createElement('div');
            badge.className = `agent-badge badge-${msg.agentUsed}`;
            badge.innerHTML = `${agentIcon(msg.agentUsed)} ${AGENT_LABELS[msg.agentUsed] ?? msg.agentUsed}`;
            wrapper.appendChild(badge);
        }

        // ── Message bubble ─────────────────────────────
        const bubble = document.createElement('div');
        bubble.className = 'message-bubble md';
        bubble.innerHTML = renderMarkdown(msg.content ?? '');
        wrapper.appendChild(bubble);

        // ── Apply / code change buttons ────────────────
        if (msg.codeChanges?.length) {
            const section = document.createElement('div');
            section.className = 'apply-section';

            msg.codeChanges
                .filter(c => c.improved)
                .forEach(change => {
                    const btn = document.createElement('button');
                    btn.className = 'apply-btn';
                    btn.innerHTML = `⚡ Apply: ${escHtml(change.description.slice(0, 60))}`;
                    btn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'applyCode', code: change.improved });
                    });
                    section.appendChild(btn);
                });

            wrapper.appendChild(section);
        }

        // ── Suggestions ────────────────────────────────
        if (msg.suggestions?.length) {
            const sugg = document.createElement('div');
            sugg.className = 'suggestions';

            const title = document.createElement('div');
            title.className = 'suggestions-title';
            title.textContent = '💡 Suggestions';
            sugg.appendChild(title);

            msg.suggestions.forEach(s => {
                const item = document.createElement('div');
                item.className = 'suggestion-item';
                item.textContent = s;
                sugg.appendChild(item);
            });

            wrapper.appendChild(sugg);
        }

        // ── Tools used ─────────────────────────────────
        if (msg.toolsUsed?.length) {
            const pills = document.createElement('div');
            pills.className = 'tools-used';
            msg.toolsUsed.forEach(t => {
                const pill = document.createElement('span');
                pill.className = 'tool-pill';
                pill.textContent = `🛠 ${t}`;
                pills.appendChild(pill);
            });
            wrapper.appendChild(pills);
        }

        // ── Metadata row ───────────────────────────────
        const meta = document.createElement('div');
        meta.className = 'message-meta';

        if (msg.timestamp) {
            const ts = document.createElement('span');
            ts.className = 'meta-item';
            ts.textContent = formatTime(msg.timestamp);
            meta.appendChild(ts);
        }

        if (msg.metadata?.durationMs) {
            const dur = document.createElement('span');
            dur.className = 'meta-item';
            dur.textContent = `${msg.metadata.durationMs}ms`;
            meta.appendChild(dur);
        }

        if (msg.metadata?.provider) {
            const prov = document.createElement('span');
            prov.className = 'meta-item';
            prov.textContent = `via ${msg.metadata.provider}`;
            meta.appendChild(prov);
        }

        wrapper.appendChild(meta);
        messagesEl.appendChild(wrapper);
        scrollToBottom();
    }

    function appendSystemNotice(text) {
        const div = document.createElement('div');
        div.style.cssText = `
      text-align: center;
      font-size: 11px;
      color: var(--fg-subtle);
      padding: 4px 0;
      animation: fadeSlideIn 0.2s ease-out;
    `;
        div.textContent = text;
        messagesEl.appendChild(div);
        scrollToBottom();
    }

    // ── Thinking indicator ────────────────────────

    function showThinking() {
        if (thinkingEl) { return; }

        thinkingEl = document.createElement('div');
        thinkingEl.className = 'thinking';

        const label = document.createElement('div');
        label.className = 'thinking-label';
        label.textContent = `${AGENT_LABELS[activeAgent] ?? 'Agent'} is reasoning…`;

        const bubble = document.createElement('div');
        bubble.className = 'thinking-bubble';
        [1, 2, 3].forEach(() => {
            const dot = document.createElement('div');
            dot.className = 'dot';
            bubble.appendChild(dot);
        });

        thinkingEl.appendChild(label);
        thinkingEl.appendChild(bubble);
        messagesEl.appendChild(thinkingEl);
        scrollToBottom();
    }

    function hideThinking() {
        if (thinkingEl) {
            thinkingEl.remove();
            thinkingEl = null;
        }
    }

    // ════════════════════════════════════════════
    //  Markdown renderer
    //  Handles the subset used by agent responses
    // ════════════════════════════════════════════

    function renderMarkdown(text) {
        if (!text) { return ''; }

        // ── Pass 1: protect fenced code blocks ────────
        const codeBlocks = [];
        text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
            const idx = codeBlocks.length;
            codeBlocks.push({ lang: lang || 'text', code: code.trim() });
            return `\x00CODE${idx}\x00`;
        });

        // ── Pass 2: inline formatting ──────────────────
        text = text
            // Headings
            .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
            .replace(/^# (.+)$/gm, '<h1>$1</h1>')
            // Horizontal rule
            .replace(/^---$/gm, '<hr>')
            // Blockquote
            .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
            // Bold + italic
            .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
            // Bold
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            // Italic
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            // Inline code (must come after bold/italic)
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            // Unordered list items
            .replace(/^[\-\*•] (.+)$/gm, '<li>$1</li>')
            // Ordered list items
            .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
            // Wrap consecutive <li> in <ul>
            .replace(/(<li>[\s\S]*?<\/li>)(\n<li>|$)/g, (m) =>
                m.includes('</li>\n<li>') ? m : m
            );

        // Wrap <li> runs in <ul>
        text = text.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`);

        // Tables: | col | col |
        text = renderTables(text);

        // Paragraphs (non-tag lines separated by blank lines)
        text = text
            .split('\n\n')
            .map(block => {
                block = block.trim();
                if (!block) { return ''; }
                // Don't wrap blocks that are already HTML tags
                if (/^<(h[1-6]|ul|ol|li|blockquote|hr|table)/.test(block)) { return block; }
                if (block.includes('\x00CODE')) { return block; }
                // Wrap plain text in <p>
                return `<p>${block.replace(/\n/g, '<br>')}</p>`;
            })
            .join('\n');

        // ── Pass 3: restore code blocks ───────────────
        text = text.replace(/\x00CODE(\d+)\x00/g, (_, idx) => {
            const { lang, code } = codeBlocks[parseInt(idx, 10)];
            return buildCodeBlock(lang, code);
        });

        return text;
    }

    function renderTables(text) {
        return text.replace(
            /(\|.+\|\n\|[-| :]+\|\n(?:\|.+\|\n?)+)/g,
            tableStr => {
                const rows = tableStr.trim().split('\n');
                const header = rows[0];
                const body = rows.slice(2);   // skip separator row

                const parseCells = row =>
                    row.split('|').slice(1, -1).map(c => c.trim());

                const headerCells = parseCells(header)
                    .map(c => `<th>${escHtml(c)}</th>`)
                    .join('');

                const bodyRows = body
                    .map(r => `<tr>${parseCells(r).map(c => `<td>${escHtml(c)}</td>`).join('')}</tr>`)
                    .join('');

                return `<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
            }
        );
    }

    function buildCodeBlock(lang, code) {
        const id = `cb_${Math.random().toString(36).slice(2, 8)}`;
        return `
<div class="code-block" id="${id}">
  <div class="code-block-header">
    <span class="code-lang">${escHtml(lang)}</span>
    <div class="code-actions">
      <button class="code-action-btn" onclick="copyBlock('${id}')">Copy</button>
      <button class="code-action-btn" onclick="applyBlock('${id}')">Apply</button>
    </div>
  </div>
  <pre><code>${escHtml(code)}</code></pre>
</div>`;
    }

    // Exposed as globals so inline onclick handlers can reach them
    window.copyBlock = function (id) {
        const el = document.getElementById(id);
        const code = el?.querySelector('code')?.textContent ?? '';
        navigator.clipboard.writeText(code).then(() => {
            const btn = el?.querySelector('.code-action-btn');
            if (btn) {
                btn.textContent = 'Copied!';
                btn.classList.add('copied');
                setTimeout(() => {
                    btn.textContent = 'Copy';
                    btn.classList.remove('copied');
                }, 1_500);
            }
        });
    };

    window.applyBlock = function (id) {
        const el = document.getElementById(id);
        const code = el?.querySelector('code')?.textContent ?? '';
        vscode.postMessage({ command: 'applyCode', code });
    };

    // ════════════════════════════════════════════
    //  Suggestion chips
    // ════════════════════════════════════════════

    function showSuggestionChips(suggestions) {
        chipsEl.innerHTML = '';
        if (!suggestions.length) {
            chipsEl.hidden = true;
            return;
        }

        suggestions.slice(0, 4).forEach(text => {
            const chip = document.createElement('button');
            chip.className = 'chip';
            chip.textContent = text;
            chip.title = text;
            chip.addEventListener('click', () => {
                inputEl.value = text;
                autoResizeTextarea();
                updateCharCount();
                clearChips();
                inputEl.focus();
            });
            chipsEl.appendChild(chip);
        });

        chipsEl.hidden = false;
    }

    function clearChips() {
        chipsEl.innerHTML = '';
        chipsEl.hidden = true;
    }

    // ════════════════════════════════════════════
    //  Stats overlays
    // ════════════════════════════════════════════

    function renderAgentStats(stats) {
        if (!stats) { statsBody.innerHTML = '<p>No stats available.</p>'; return; }

        const rows = [
            ['Total executions', stats.totalExecutions ?? 0],
            ['Success rate', stats.successRate ?? 'n/a'],
        ];

        if (stats.byAgentType) {
            Object.entries(stats.byAgentType).forEach(([agent, count]) => {
                rows.push([`  ${AGENT_LABELS[agent] ?? agent}`, count]);
            });
        }

        if (stats.memoryStats) {
            rows.push(['── Memory ──', '']);
            rows.push(['Total memories', stats.memoryStats.totalMemories ?? 0]);
            rows.push(['Conversation turns', stats.memoryStats.conversationTurns ?? 0]);
        }

        if (stats.toolStats) {
            rows.push(['── Tools ──', '']);
            rows.push(['Total tools', stats.toolStats.totalTools ?? 0]);
            rows.push(['Total tool runs', stats.toolStats.totalRuns ?? 0]);
        }

        statsBody.innerHTML = `
      <table class="stats-table">
        <thead><tr><th>Metric</th><th>Value</th></tr></thead>
        <tbody>
          ${rows.map(([k, v]) =>
            `<tr><td>${escHtml(String(k))}</td><td>${escHtml(String(v))}</td></tr>`
        ).join('')}
        </tbody>
      </table>`;
    }

    function renderMemoryStats(stats) {
        renderAgentStats({ memoryStats: stats });
    }

    // ════════════════════════════════════════════
    //  Tool grid
    // ════════════════════════════════════════════

    function renderToolGrid() {
        TOOL_CATALOGUE.forEach(({ name, icon }) => {
            const btn = document.createElement('button');
            btn.className = 'tool-btn';
            btn.textContent = `${icon} ${name}`;
            btn.title = `Run tool: ${name}`;
            btn.addEventListener('click', () => {
                closeOverlay('toolsOverlay');
                inputEl.value = `Run tool: ${name}`;
                autoResizeTextarea();
                inputEl.focus();
            });
            toolGrid.appendChild(btn);
        });
    }

    // ════════════════════════════════════════════
    //  Overlay helpers
    // ════════════════════════════════════════════

    function openOverlay(id) {
        const el = document.getElementById(id);
        if (el) { el.hidden = false; }
    }

    function closeOverlay(id) {
        const el = document.getElementById(id);
        if (el) { el.hidden = true; }
    }

    // ════════════════════════════════════════════
    //  Confirm dialog (Promise-based)
    // ════════════════════════════════════════════

    function confirm(message) {
        confirmMsg.textContent = message;
        confirmBack.hidden = false;

        return new Promise(resolve => {
            confirmResolve = resolve;
        });
    }

    function resolveConfirm(value) {
        if (confirmResolve) {
            confirmResolve(value);
            confirmResolve = null;
            confirmBack.hidden = true;
        }
    }

    // ════════════════════════════════════════════
    //  Input helpers
    // ════════════════════════════════════════════

    function autoResizeTextarea() {
        inputEl.style.height = 'auto';
        inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
    }

    function updateCharCount() {
        const len = inputEl.value.length;
        if (len === 0) {
            charCount.textContent = '';
            charCount.className = 'char-count';
            return;
        }
        charCount.textContent = `${len} / ${MAX_CHARS}`;
        charCount.className = len > MAX_CHARS * 0.9
            ? 'char-count limit'
            : len > MAX_CHARS * 0.7
                ? 'char-count warn'
                : 'char-count';

        sendBtn.disabled = len > MAX_CHARS || isSending;
    }

    function agentHint(agent) {
        const hints = {
            general: 'Ask anything about your code… (Enter to send, Shift+Enter for new line)',
            analysis: 'Describe or paste code to analyze for quality, security, and performance…',
            debugging: 'Describe the bug or paste failing code…',
            refactoring: 'Paste code to refactor or describe what to improve…',
            testing: 'Paste a function or class to generate tests for…',
            architecture: 'Describe your system or ask for design advice…',
        };
        return hints[agent] ?? hints.general;
    }

    // ════════════════════════════════════════════
    //  Utilities
    // ════════════════════════════════════════════

    function scrollToBottom() {
        requestAnimationFrame(() => {
            messagesEl.scrollTop = messagesEl.scrollHeight;
        });
    }

    function formatTime(ts) {
        return new Date(ts).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    function agentIcon(agent) {
        const icons = {
            general: '🤖',
            analysis: '🔍',
            debugging: '🐛',
            refactoring: '🔧',
            testing: '🧪',
            architecture: '🏗️',
        };
        return icons[agent] ?? '🤖';
    }

    function escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ════════════════════════════════════════════
    //  Boot
    // ════════════════════════════════════════════

    init();

})();