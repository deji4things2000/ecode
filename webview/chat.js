/* ════════════════════════════════════════════
   chat.js — AI Agent WebView frontend
   Includes: core chat, markdown renderer,
   provider switcher, tool browser, stats overlay,
   suggestion chips, confirm dialog
   ════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── VS Code API ─────────────────────────────
  const vscode = acquireVsCodeApi();

  // ── DOM refs ────────────────────────────────
  const messagesEl   = document.getElementById('messages');
  const inputEl      = document.getElementById('messageInput');
  const sendBtn      = document.getElementById('sendBtn');
  const charCount    = document.getElementById('charCount');
  const inputHint    = document.getElementById('inputHint');
  const agentLabel   = document.getElementById('agentLabel');
  const chipsEl      = document.getElementById('chips');
  const welcomeCard  = document.getElementById('welcomeCard');
  const statsOverlay = document.getElementById('statsOverlay');
  const toolsOverlay = document.getElementById('toolsOverlay');
  const statsBody    = document.getElementById('statsBody');
  const toolGrid     = document.getElementById('toolGrid');
  const confirmBack  = document.getElementById('confirmBackdrop');
  const confirmMsg   = document.getElementById('confirmMsg');
  const confirmYes   = document.getElementById('confirmYes');
  const confirmNo    = document.getElementById('confirmNo');

  // ── State ────────────────────────────────────
  let thinkingEl     = null;
  let isSending      = false;
  let confirmResolve = null;
  let activeProvider = 'mock';
  let activeModel    = '';

  // ── Constants ────────────────────────────────
  const MAX_CHARS = 4_000;

  const AGENT_LABELS = {
    general:      'General Agent',
    analysis:     'Code Analysis Agent',
    debugging:    'Debug Agent',
    refactoring:  'Refactoring Agent',
    testing:      'Test Generation Agent',
    architecture: 'Architecture Agent',
  };

  const AGENT_ICONS = {
    general:      '🤖',
    analysis:     '🔍',
    debugging:    '🐛',
    refactoring:  '🔧',
    testing:      '🧪',
    architecture: '🏗️',
  };

  // ── Provider catalogue (mirrors ProviderRegistry.ts) ──
  const PROVIDER_INFO = {
    openai:    { icon: '✨', label: 'OpenAI',       color: '#e8e84a', local: false },
    anthropic: { icon: '🌟', label: 'Anthropic',    color: '#e84a4a', local: false },
    ollama:    { icon: '🦙', label: 'Ollama',       color: '#e8a04a', local: true  },
    cline:     { icon: '🔧', label: 'Cline',        color: '#4a9ee8', local: false },
    aider:     { icon: '🔀', label: 'Aider',        color: '#4ae86a', local: false },
    cortex:    { icon: '🧠', label: 'CortexIDE',    color: '#a04ae8', local: true  },
    localllm:  { icon: '💻', label: 'Local LLM',    color: '#4ae8d4', local: true  },
    mock:      { icon: '🎮', label: 'Demo Mode',    color: '#888888', local: true  },
  };

  const TOOL_CATALOGUE = [
    { name: 'readFile',       icon: '📄', category: 'filesystem'  },
    { name: 'writeFile',      icon: '💾', category: 'filesystem'  },
    { name: 'listDirectory',  icon: '📁', category: 'filesystem'  },
    { name: 'fileExists',     icon: '🔎', category: 'filesystem'  },
    { name: 'searchFiles',    icon: '🔍', category: 'filesystem'  },
    { name: 'getActiveCode',  icon: '✏️',  category: 'editor'      },
    { name: 'insertCode',     icon: '➕', category: 'editor'      },
    { name: 'replaceCode',    icon: '🔄', category: 'editor'      },
    { name: 'openFile',       icon: '📂', category: 'editor'      },
    { name: 'getCursorPosition', icon: '📍', category: 'editor'   },
    { name: 'searchInFiles',  icon: '🔎', category: 'search'      },
    { name: 'findSymbol',     icon: '🔗', category: 'search'      },
    { name: 'getDiagnostics', icon: '🩺', category: 'diagnostics' },
    { name: 'getFileLanguage',icon: '🏷️', category: 'analysis'    },
    { name: 'countLines',     icon: '🔢', category: 'analysis'    },
    { name: 'gitStatus',      icon: '📋', category: 'git'         },
    { name: 'gitDiff',        icon: '📝', category: 'git'         },
    { name: 'gitLog',         icon: '📜', category: 'git'         },
    { name: 'showMessage',    icon: '💬', category: 'utility'     },
    { name: 'copyToClipboard',icon: '📋', category: 'utility'     },
    { name: 'getTimestamp',   icon: '🕐', category: 'utility'     },
    { name: 'formatCode',     icon: '✨', category: 'utility'     },
  ];

  // ════════════════════════════════════════════
  //  Initialisation
  // ════════════════════════════════════════════

  function init() {
    bindEventListeners();
    renderToolGrid();
    injectProviderBadge();
    injectProviderStyles();
    inputEl.focus();
  }

  // ════════════════════════════════════════════
  //  Event listeners
  // ════════════════════════════════════════════

  function bindEventListeners() {

    // ── Send ──────────────────────────────────
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

    // ── Attach active editor code ──────────────
    const attachBtn = document.getElementById('attachBtn');
    if (attachBtn) {
      attachBtn.addEventListener('click', () => {
        const prefix = '[Using active editor code]\n';
        if (!inputEl.value.startsWith(prefix)) {
          inputEl.value = prefix + inputEl.value;
          autoResizeTextarea();
          updateCharCount();
        }
        inputEl.focus();
      });
    }

    // ── Header buttons ─────────────────────────
    const statsBtn = document.getElementById('statsBtn');
    if (statsBtn) {
      statsBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'getAgentStats' });
        openOverlay('statsOverlay');
      });
    }

    const toolsBtn = document.getElementById('toolsBtn');
    if (toolsBtn) {
      toolsBtn.addEventListener('click', () => {
        openOverlay('toolsOverlay');
      });
    }

    const clearBtn = document.getElementById('clearBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        const confirmed = await showConfirm(
          'Clear all chat messages and agent memory?'
        );
        if (confirmed) {
          vscode.postMessage({ command: 'clearChat' });
        }
      });
    }

    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        vscode.postMessage({
          command: 'runTool',
          tool:    'showMessage',
          params:  {
            message: 'Open VS Code settings (Ctrl+,) and search "aiAgent" to configure.',
            type:    'info',
          },
        });
      });
    }

    const providerBtn = document.getElementById('providerBtn');
    if (providerBtn) {
      providerBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'openProviderSelector' });
      });
    }

    // ── No agent tabs — auto-routing on backend ──

    // ── Overlay close buttons ──────────────────
    document.querySelectorAll('.close-overlay').forEach(btn => {
      btn.addEventListener('click', () => {
        closeOverlay(btn.dataset.target);
      });
    });

    // Click backdrop to close overlay
    [statsOverlay, toolsOverlay].forEach(overlay => {
      if (!overlay) { return; }
      overlay.addEventListener('click', e => {
        if (e.target === overlay) { closeOverlay(overlay.id); }
      });
    });

    // ── Confirm dialog ─────────────────────────
    if (confirmYes) { confirmYes.addEventListener('click', () => resolveConfirm(true));  }
    if (confirmNo)  { confirmNo.addEventListener('click',  () => resolveConfirm(false)); }
    if (confirmBack) {
      confirmBack.addEventListener('click', e => {
        if (e.target === confirmBack) { resolveConfirm(false); }
      });
    }

    // ── Escape key ─────────────────────────────
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
    if (welcomeCard && welcomeCard.parentNode) {
      welcomeCard.remove();
    }

    // Backend handles auto-routing based on keywords
    appendUserMessage(text);
    clearChips();

    vscode.postMessage({ command: 'sendMessage', text });

    inputEl.value = '';
    autoResizeTextarea();
    updateCharCount();
    setSending(true);
  }

  function setSending(sending) {
    isSending        = sending;
    sendBtn.disabled = sending;
    inputEl.disabled = sending;
  }

  // ════════════════════════════════════════════
  //  Messages from extension → webview
  // ════════════════════════════════════════════

  window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.command) {
      case 'showThinking':    onShowThinking();                        break;
      case 'receiveMessage':  onReceiveMessage(msg.message);          break;
      case 'chatCleared':     onChatCleared();                        break;
      case 'memoryStats':     renderMemoryStats(msg.stats);           break;
      case 'agentStats':      renderAgentStats(msg.stats);            break;
      case 'toolResult':      onToolResult(msg.tool, msg.result);     break;
      case 'providerChanged': onProviderChanged(msg.providerId, msg.model); break;
      case 'providerChanged': onProviderChanged(msg.providerId, msg.model); break;
    }
  });

  function onShowThinking() {
    showThinking();
  }

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
    hideThinking();
    setSending(false);

    const content = result.success
      ? `**Tool \`${toolName}\` result:**\n\n${result.output}`
      : `**Tool \`${toolName}\` failed:** ${result.error ?? 'Unknown error'}`;

    appendAssistantMessage({
      role:      'assistant',
      content,
      agentUsed: 'general',
      timestamp: Date.now(),
    });
  }

  function onProviderChanged(providerId, model) {
    activeProvider = providerId ?? 'mock';
    activeModel    = model ?? '';
    updateProviderBadge(activeProvider, activeModel);
    appendSystemNotice(
      `${PROVIDER_INFO[activeProvider]?.icon ?? '🤖'} Switched to ` +
      `${PROVIDER_INFO[activeProvider]?.label ?? providerId}` +
      (model ? ` — ${model}` : '')
    );
  }

  // ════════════════════════════════════════════
  //  DOM — building messages
  // ════════════════════════════════════════════

  function appendUserMessage(text) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message user';

    const bubble = document.createElement('div');
    bubble.className   = 'message-bubble';
    bubble.textContent = text;

    const ts = document.createElement('div');
    ts.className   = 'message-timestamp';
    ts.textContent = formatTime(Date.now());

    wrapper.appendChild(bubble);
    wrapper.appendChild(ts);
    messagesEl.appendChild(wrapper);
    scrollToBottom();
  }

  function appendAssistantMessage(msg) {
    const wrapper = document.createElement('div');
    wrapper.className = `message assistant${msg.isError ? ' error' : ''}`;

    // ── Agent badge ──────────────────────────────
    if (msg.agentUsed) {
      const badge = document.createElement('div');
      badge.className = `agent-badge badge-${msg.agentUsed}`;
      badge.innerHTML =
        `${agentIcon(msg.agentUsed)} ` +
        `${escHtml(AGENT_LABELS[msg.agentUsed] ?? msg.agentUsed)}`;
      wrapper.appendChild(badge);
    }

    // ── Message bubble ───────────────────────────
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble md';
    bubble.innerHTML  = renderMarkdown(msg.content ?? '');
    wrapper.appendChild(bubble);

    // ── Apply / code change buttons ──────────────
    if (msg.codeChanges?.length) {
      const section = document.createElement('div');
      section.className = 'apply-section';

      msg.codeChanges
        .filter(c => c.improved)
        .forEach(change => {
          const btn     = document.createElement('button');
          btn.className = 'apply-btn';
          btn.innerHTML =
            `⚡ Apply: ${escHtml(change.description.slice(0, 60))}`;
          btn.addEventListener('click', () => {
            vscode.postMessage({ command: 'applyCode', code: change.improved });
          });
          section.appendChild(btn);
        });

      wrapper.appendChild(section);
    }

    // ── Suggestions list ─────────────────────────
    if (msg.suggestions?.length) {
      const sugg  = document.createElement('div');
      sugg.className = 'suggestions';

      const title = document.createElement('div');
      title.className   = 'suggestions-title';
      title.textContent = '💡 Suggestions';
      sugg.appendChild(title);

      msg.suggestions.forEach(s => {
        const item = document.createElement('div');
        item.className   = 'suggestion-item';
        item.textContent = s;
        sugg.appendChild(item);
      });

      wrapper.appendChild(sugg);
    }

    // ── Tools used pills ─────────────────────────
    if (msg.toolsUsed?.length) {
      const pills = document.createElement('div');
      pills.className = 'tools-used';

      msg.toolsUsed.forEach(t => {
        const pill = document.createElement('span');
        pill.className   = 'tool-pill';
        pill.textContent = `🛠 ${t}`;
        pills.appendChild(pill);
      });

      wrapper.appendChild(pills);
    }

    // ── Metadata row ─────────────────────────────
    const meta = document.createElement('div');
    meta.className = 'message-meta';

    if (msg.timestamp) {
      const ts = document.createElement('span');
      ts.className   = 'meta-item';
      ts.textContent = formatTime(msg.timestamp);
      meta.appendChild(ts);
    }

    if (msg.metadata?.durationMs) {
      const dur = document.createElement('span');
      dur.className   = 'meta-item';
      dur.textContent = `${msg.metadata.durationMs}ms`;
      meta.appendChild(dur);
    }

    if (msg.metadata?.provider) {
      const prov = document.createElement('span');
      prov.className   = 'meta-item';
      prov.textContent = `via ${msg.metadata.provider}`;
      meta.appendChild(prov);
    }

    wrapper.appendChild(meta);
    messagesEl.appendChild(wrapper);
    scrollToBottom();
  }

  function appendSystemNotice(text) {
    const div = document.createElement('div');
    div.style.cssText = [
      'text-align: center',
      'font-size: 11px',
      'color: var(--fg-subtle)',
      'padding: 4px 0',
      'animation: fadeSlideIn 0.2s ease-out',
    ].join(';');
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
    label.className   = 'thinking-label';
    label.textContent = 'AI Agent is reasoning…';

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
  // ════════════════════════════════════════════

  function renderMarkdown(text) {
    if (!text) { return ''; }

    // ── Pass 1: extract fenced code blocks ───────
    const codeBlocks = [];
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push({ lang: lang.trim() || 'text', code: code.trim() });
      return `\x00CODE${idx}\x00`;
    });

    // ── Pass 2: inline formatting ─────────────────
    text = text
      // Headings (must come before bold/italic)
      .replace(/^#### (.+)$/gm,  '<h4>$1</h4>')
      .replace(/^### (.+)$/gm,   '<h3>$1</h3>')
      .replace(/^## (.+)$/gm,    '<h2>$1</h2>')
      .replace(/^# (.+)$/gm,     '<h1>$1</h1>')
      // Horizontal rule
      .replace(/^---$/gm,        '<hr>')
      // Blockquote
      .replace(/^> (.+)$/gm,     '<blockquote>$1</blockquote>')
      // Bold + italic
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Italic (single asterisk)
      .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
      // Inline code — must run after bold/italic
      .replace(/`([^`\n]+)`/g,   '<code>$1</code>')
      // Unordered list items
      .replace(/^[ \t]*[-*•] (.+)$/gm, '<li>$1</li>')
      // Ordered list items
      .replace(/^[ \t]*\d+\. (.+)$/gm, '<li>$1</li>');

    // Wrap consecutive <li> runs in <ul>
    text = text.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, m => `<ul>${m}</ul>`);

    // Tables
    text = renderTables(text);

    // ── Pass 3: paragraphs ────────────────────────
    text = text
      .split(/\n{2,}/)
      .map(block => {
        block = block.trim();
        if (!block) { return ''; }
        // Already an HTML block — leave alone
        if (/^<(h[1-6]|ul|ol|blockquote|hr|table|pre|div)/.test(block)) {
          return block;
        }
        // Code block placeholder — leave alone
        if (block.includes('\x00CODE')) { return block; }
        // Wrap plain text in <p>, convert single newlines to <br>
        return `<p>${block.replace(/\n/g, '<br>')}</p>`;
      })
      .join('\n');

    // ── Pass 4: restore code blocks ───────────────
    text = text.replace(/\x00CODE(\d+)\x00/g, (_, idx) => {
      const { lang, code } = codeBlocks[parseInt(idx, 10)];
      return buildCodeBlock(lang, code);
    });

    return text;
  }

  function renderTables(text) {
    // Match GFM-style tables: header row, separator row, body rows
    return text.replace(
      /(\|.+\|\n\|[-| :]+\|\n(?:\|.+\|\n?)+)/g,
      tableStr => {
        const rows   = tableStr.trim().split('\n');
        const header = rows[0];
        const body   = rows.slice(2);   // skip the --- separator row

        const parseCells = row =>
          row.split('|').slice(1, -1).map(c => c.trim());

        const headerCells = parseCells(header)
          .map(c => `<th>${escHtml(c)}</th>`)
          .join('');

        const bodyRows = body
          .map(r =>
            `<tr>${parseCells(r).map(c => `<td>${escHtml(c)}</td>`).join('')}</tr>`
          )
          .join('');

        return (
          `<table>` +
          `<thead><tr>${headerCells}</tr></thead>` +
          `<tbody>${bodyRows}</tbody>` +
          `</table>`
        );
      }
    );
  }

  function buildCodeBlock(lang, code) {
    const id = `cb_${Math.random().toString(36).slice(2, 8)}`;
    return (
      `<div class="code-block" id="${escAttr(id)}">` +
        `<div class="code-block-header">` +
          `<span class="code-lang">${escHtml(lang)}</span>` +
          `<div class="code-actions">` +
            `<button class="code-action-btn" ` +
              `onclick="copyBlock('${escAttr(id)}')">Copy</button>` +
            `<button class="code-action-btn" ` +
              `onclick="applyBlock('${escAttr(id)}')">Apply</button>` +
          `</div>` +
        `</div>` +
        `<pre><code>${escHtml(code)}</code></pre>` +
      `</div>`
    );
  }

  // Exposed as globals so inline onclick= handlers can reach them
  window.copyBlock = function (id) {
    const el   = document.getElementById(id);
    const code = el?.querySelector('code')?.textContent ?? '';

    navigator.clipboard.writeText(code).then(() => {
      const btn = el?.querySelector('.code-action-btn');
      if (!btn) { return; }
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('copied');
      }, 1_500);
    }).catch(() => {
      // Clipboard API may be unavailable in some webview contexts
      vscode.postMessage({ command: 'copyCode', code });
    });
  };

  window.applyBlock = function (id) {
    const el   = document.getElementById(id);
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
      const chip     = document.createElement('button');
      chip.className = 'chip';
      chip.textContent = text;
      chip.title       = text;

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
    chipsEl.hidden    = true;
  }

  // ════════════════════════════════════════════
  //  Provider badge
  // ════════════════════════════════════════════

  function injectProviderBadge() {
    const headerRight = document.querySelector('.header-right');
    if (!headerRight || document.getElementById('providerBadge')) { return; }

    const badge     = document.createElement('button');
    badge.id        = 'providerBadge';
    badge.className = 'provider-badge';
    badge.title     = 'Switch AI provider (Ctrl+Shift+P → AI Agent: Switch Provider)';
    badge.innerHTML = `${PROVIDER_INFO.mock.icon} ${PROVIDER_INFO.mock.label}`;

    badge.addEventListener('click', () => {
      vscode.postMessage({
        command: 'runTool',
        tool:    'showMessage',
        params:  {
          message: 'Use Ctrl+Shift+P → "AI Agent: Switch Provider" to change provider.',
          type:    'info',
        },
      });
    });

    // Insert before the first .icon-btn so it sits on the left of them
    const firstIconBtn = headerRight.querySelector('.icon-btn');
    headerRight.insertBefore(badge, firstIconBtn);
  }

  function updateProviderBadge(providerId, model) {
    const badge = document.getElementById('providerBadge');
    if (!badge) { return; }

    const info    = PROVIDER_INFO[providerId] ?? PROVIDER_INFO.mock;
    const display = model ? `${info.icon} ${info.label} · ${model}` : `${info.icon} ${info.label}`;

    badge.innerHTML        = display;
    badge.style.borderColor = info.color;
    badge.style.color       = info.color;
    badge.title =
      `Provider: ${info.label}` +
      (model ? `\nModel: ${model}` : '') +
      `\n${info.local ? '🖥 Local — no API key needed' : '☁️ Cloud'}` +
      `\nClick for switch instructions`;
  }

  function injectProviderStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .provider-badge {
        display:       flex;
        align-items:   center;
        gap:           4px;
        padding:       3px 10px;
        background:    transparent;
        border:        1px solid var(--border);
        border-radius: 10px;
        font-size:     11px;
        font-weight:   600;
        cursor:        pointer;
        color:         var(--fg-muted);
        transition:    all 0.15s ease;
        white-space:   nowrap;
        max-width:     180px;
        overflow:      hidden;
        text-overflow: ellipsis;
      }
      .provider-badge:hover {
        background: var(--bg-hover);
        color:      var(--fg);
      }
      .provider-badge:focus-visible {
        outline: 2px solid var(--border-focus);
        outline-offset: 1px;
      }
    `;
    document.head.appendChild(style);
  }

  // ════════════════════════════════════════════
  //  Stats overlays
  // ════════════════════════════════════════════

  function renderAgentStats(stats) {
    if (!stats) {
      statsBody.innerHTML = '<p style="color:var(--fg-muted)">No stats available.</p>';
      return;
    }

    const rows = [
      ['Total executions', stats.totalExecutions  ?? 0],
      ['Success rate',     stats.successRate      ?? 'n/a'],
      ['Active provider',  stats.activeProvider   ?? activeProvider],
    ];

    if (stats.byAgentType && Object.keys(stats.byAgentType).length) {
      rows.push(['── By Agent ──', '']);
      Object.entries(stats.byAgentType).forEach(([agent, count]) => {
        rows.push([
          `  ${agentIcon(agent)} ${AGENT_LABELS[agent] ?? agent}`,
          String(count),
        ]);
      });
    }

    if (stats.memoryStats) {
      rows.push(['── Memory ──', '']);
      rows.push(['Total memories',     stats.memoryStats.totalMemories     ?? 0]);
      rows.push(['Conversation turns', stats.memoryStats.conversationTurns ?? 0]);
      rows.push(['Code analyses',      stats.memoryStats.byType?.codeAnalysis   ?? 0]);
      rows.push(['Project contexts',   stats.memoryStats.byType?.projectContext  ?? 0]);
    }

    if (stats.toolStats) {
      rows.push(['── Tools ──', '']);
      rows.push(['Registered tools', stats.toolStats.totalTools ?? 0]);
      rows.push(['Total tool runs',  stats.toolStats.totalRuns  ?? 0]);
      rows.push(['Success rate',     stats.toolStats.successRate ?? 'n/a']);
    }

    if (stats.recentTasks?.length) {
      rows.push(['── Recent Tasks ──', '']);
      stats.recentTasks.forEach((t, i) => {
        rows.push([
          `  ${i + 1}. ${agentIcon(t.type)} ${t.type}`,
          `${t.success ? '✅' : '❌'} ${t.durationMs ?? '?'}ms`,
        ]);
      });
    }

    statsBody.innerHTML =
      `<table class="stats-table">` +
        `<thead><tr><th>Metric</th><th>Value</th></tr></thead>` +
        `<tbody>` +
          rows.map(([k, v]) =>
            `<tr>` +
              `<td>${escHtml(String(k))}</td>` +
              `<td>${escHtml(String(v))}</td>` +
            `</tr>`
          ).join('') +
        `</tbody>` +
      `</table>`;
  }

  function renderMemoryStats(stats) {
    renderAgentStats({ memoryStats: stats });
  }

  // ════════════════════════════════════════════
  //  Tool grid
  // ════════════════════════════════════════════

  function renderToolGrid() {
    if (!toolGrid) { return; }

    // Group tools by category
    const categories = {};
    TOOL_CATALOGUE.forEach(tool => {
      if (!categories[tool.category]) { categories[tool.category] = []; }
      categories[tool.category].push(tool);
    });

    Object.entries(categories).forEach(([category, tools]) => {
      // Category header
      const header = document.createElement('div');
      header.style.cssText = [
        'grid-column: 1 / -1',
        'font-size: 10px',
        'font-weight: 600',
        'text-transform: uppercase',
        'letter-spacing: 0.5px',
        'color: var(--fg-muted)',
        'margin-top: 8px',
        'padding: 2px 0',
        'border-bottom: 1px solid var(--border)',
      ].join(';');
      header.textContent = category;
      toolGrid.appendChild(header);

      // Tool buttons
      tools.forEach(({ name, icon }) => {
        const btn     = document.createElement('button');
        btn.className = 'tool-btn';
        btn.innerHTML = `${icon} <span>${escHtml(name)}</span>`;
        btn.title     = `Run tool: ${name}`;

        btn.addEventListener('click', () => {
          closeOverlay('toolsOverlay');
          inputEl.value = `Run tool: ${name}`;
          autoResizeTextarea();
          updateCharCount();
          inputEl.focus();
        });

        toolGrid.appendChild(btn);
      });
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

  function showConfirm(message) {
    if (confirmMsg)  { confirmMsg.textContent = message; }
    if (confirmBack) { confirmBack.hidden = false; }

    return new Promise(resolve => {
      confirmResolve = resolve;
    });
  }

  function resolveConfirm(value) {
    if (confirmResolve) {
      confirmResolve(value);
      confirmResolve = null;
    }
    if (confirmBack) { confirmBack.hidden = true; }
  }

  // ════════════════════════════════════════════
  //  Input helpers
  // ════════════════════════════════════════════

  function autoResizeTextarea() {
    inputEl.style.height = 'auto';
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, 160)}px`;
  }

  function updateCharCount() {
    const len = inputEl.value.length;

    if (len === 0) {
      charCount.textContent = '';
      charCount.className   = 'char-count';
      sendBtn.disabled      = isSending;
      return;
    }

    charCount.textContent = `${len} / ${MAX_CHARS}`;
    charCount.className   =
      len > MAX_CHARS * 0.9 ? 'char-count limit' :
      len > MAX_CHARS * 0.7 ? 'char-count warn'  :
      'char-count';

    sendBtn.disabled = len > MAX_CHARS || isSending;
  }

  function agentHint(agent) {
    const hints = {
      general:      'Ask anything about your code… (Enter to send, Shift+Enter for new line)',
      analysis:     'Describe or paste code to analyze for quality, security, and performance…',
      debugging:    'Describe the bug or paste failing code…',
      refactoring:  'Paste code to refactor or describe what to improve…',
      testing:      'Paste a function or class to generate tests for…',
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
      hour:   '2-digit',
      minute: '2-digit',
    });
  }

  function agentIcon(agent) {
    return AGENT_ICONS[agent] ?? '🤖';
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#39;');
  }

  // escAttr is used inside attribute values (onclick="...")
  function escAttr(str) {
    return String(str)
      .replace(/&/g,  '&amp;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#39;');
  }

  // ════════════════════════════════════════════
  //  Boot
  // ════════════════════════════════════════════

  init();

})();