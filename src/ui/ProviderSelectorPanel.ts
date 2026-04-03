import * as vscode          from 'vscode';
import * as path            from 'path';
import {
  ProviderRegistry,
  ProviderMeta,
  ProviderID,
  ProviderStatus,
} from '../providers/ProviderRegistry';

// ─────────────────────────────────────────────
//  ProviderSelectorPanel
//  A dedicated webview for browsing, installing,
//  and switching AI providers from inside the
//  extension UI — no Command Palette required.
// ─────────────────────────────────────────────

export class ProviderSelectorPanel {
  private static instance: ProviderSelectorPanel | undefined;
  private readonly panel:  vscode.WebviewPanel;
  private isDisposed = false;

  private constructor(
    private readonly registry: ProviderRegistry,
    private readonly context:  vscode.ExtensionContext
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'aiAgentProviders',
      '🤖 AI Agent — Select Provider',
      vscode.ViewColumn.One,
      {
        enableScripts:           true,
        retainContextWhenHidden: true,
      }
    );

    this.panel.webview.html = this.buildHtml();
    this.registerHandlers();

    this.panel.onDidDispose(() => {
      this.isDisposed              = true;
      ProviderSelectorPanel.instance = undefined;
    });

    // Listen to install progress events from registry
    this.registry.onInstallProgress((id, status) => {
      this.post({ command: 'installProgress', id, status });
    });

    // Send initial data once the webview is ready
    // Small delay ensures the webview JS has executed
    setTimeout(() => this.sendProviderData(), 300);
  }

  // ── Singleton factory ─────────────────────────

  static create(
    registry: ProviderRegistry,
    context:  vscode.ExtensionContext
  ): ProviderSelectorPanel {
    if (ProviderSelectorPanel.instance?.isDisposed === false) {
      ProviderSelectorPanel.instance.panel.reveal(vscode.ViewColumn.One);
      ProviderSelectorPanel.instance.refresh();
      return ProviderSelectorPanel.instance;
    }
    ProviderSelectorPanel.instance = new ProviderSelectorPanel(registry, context);
    return ProviderSelectorPanel.instance;
  }

  // ── Public ────────────────────────────────────

  async refresh(): Promise<void> {
    await this.registry.detectAllStatuses();
    this.sendProviderData();
  }

  // ── Message handlers ──────────────────────────

  private registerHandlers(): void {
    this.panel.webview.onDidReceiveMessage(async msg => {
      switch (msg.command) {

        case 'ready':
          // Webview finished loading — send data immediately (don't block on detection)
          this.sendProviderData();
          // Run detection async in background to show statuses as they complete
          this.registry.detectAllStatuses()
            .then(() => this.sendProviderData())
            .catch(err => console.error('[AI Agent] Status detection error:', err));
          break;

        case 'selectProvider':
          await this.handleSelect(msg.id as ProviderID);
          break;

        case 'installProvider':
          await this.handleInstall(msg.id as ProviderID);
          break;

        case 'startProvider':
          await this.handleStart(msg.id as ProviderID);
          break;

        case 'enterApiKey':
          await this.handleApiKey(msg.id as ProviderID);
          break;

        case 'openUrl':
          vscode.env.openExternal(vscode.Uri.parse(msg.url));
          break;

        case 'refreshStatuses':
          await this.registry.detectAllStatuses();
          this.sendProviderData();
          break;

        case 'selectModel':
          await this.handleModelSelect(msg.id as ProviderID, msg.model);
          break;
      }
    });
  }

  // ── Action handlers ───────────────────────────

  private async handleSelect(id: ProviderID): Promise<void> {
    const meta = this.registry.getMeta(id);

    // Guard: needs API key
    if (meta.requiresKey && meta.status === 'needs-key') {
      await this.handleApiKey(id);
      return;
    }

    // Guard: needs installation
    if (meta.status === 'not-installed') {
      const answer = await vscode.window.showWarningMessage(
        `${meta.icon} ${meta.displayName} is not installed.`,
        'Install Now',
        'Open Download Page',
        'Cancel'
      );
      if (answer === 'Install Now')        { await this.handleInstall(id); }
      if (answer === 'Open Download Page') { vscode.env.openExternal(vscode.Uri.parse(meta.setupUrl)); }
      return;
    }

    // Guard: needs server start
    if (meta.status === 'not-running') {
      const answer = await vscode.window.showWarningMessage(
        `${meta.icon} ${meta.displayName} is installed but not running.`,
        'Start Server',
        'Cancel'
      );
      if (answer === 'Start Server') { await this.handleStart(id); }
      return;
    }

    // All clear — switch provider
    try {
      await this.registry.switchProvider(id);
      this.post({ command: 'providerSelected', id });
      vscode.window.showInformationMessage(
        `${meta.icon} Switched to ${meta.displayName}`
      );
      // Refresh to show updated active state
      this.sendProviderData();
    } catch (err: any) {
      vscode.window.showErrorMessage(
        `Failed to switch to ${meta.displayName}: ${err.message}`
      );
    }
  }

  private async handleInstall(id: ProviderID): Promise<void> {
    const meta = this.registry.getMeta(id);

    this.post({ command: 'setStatus', id, status: 'installing' });

    // autoInstall now handles polling and emits progress events
    // Progress events are sent to webview via registry.onInstallProgress listener
    const success = await this.registry.autoInstall(id);

    if (!success && meta.setupUrl) {
      // No install command — open download page
      vscode.env.openExternal(vscode.Uri.parse(meta.setupUrl));
    }
  }

  private async handleStart(id: ProviderID): Promise<void> {
    const meta = this.registry.getMeta(id);

    this.post({ command: 'setStatus', id, status: 'starting' });
    await this.registry.autoStart(id);

    // Poll for the server to come up
    this.pollStatus(id, 2_000, 15);

    vscode.window.showInformationMessage(
      `${meta.icon} Starting ${meta.displayName}…`
    );
  }

  private async handleApiKey(id: ProviderID): Promise<void> {
    const meta     = this.registry.getMeta(id);
    const configKey = id === 'openai' ? 'openaiApiKey' : 'anthropicApiKey';
    const link      = id === 'openai'
      ? 'https://platform.openai.com/api-keys'
      : 'https://console.anthropic.com';

    const key = await vscode.window.showInputBox({
      title:         `${meta.icon} Enter ${meta.displayName} API Key`,
      prompt:        `Paste your ${meta.displayName} API key (get one at ${link})`,
      password:      true,
      placeHolder:   id === 'openai' ? 'sk-…' : 'sk-ant-…',
      validateInput: v =>
        !v || v.length < 10 ? 'Key is too short' : null,
    });

    if (!key) { return; }

    const config = vscode.workspace.getConfiguration('aiAgent');
    await config.update(
      configKey,
      key,
      vscode.ConfigurationTarget.Global
    );

    vscode.window.showInformationMessage(
      `${meta.icon} API key saved for ${meta.displayName}`
    );

    // Re-detect status and switch
    await this.registry.detectStatus(meta);
    this.sendProviderData();

    if (meta.status === 'ready') {
      await this.handleSelect(id);
    }
  }

  private async handleModelSelect(
    id:    ProviderID,
    model: string
  ): Promise<void> {
    const config    = vscode.workspace.getConfiguration('aiAgent');
    const configKey = id === 'openai' || id === 'anthropic'
      ? 'model'
      : `${id}.model`;

    await config.update(configKey, model, vscode.ConfigurationTarget.Global);

    // Rebuild provider with new model
    await this.registry.switchProvider(id);
    vscode.window.showInformationMessage(`Model set to ${model}`);
  }

  // ── Polling ───────────────────────────────────

  private pollStatus(
    id:           ProviderID,
    intervalMs:   number,
    maxAttempts:  number
  ): void {
    let attempts = 0;

    const timer = setInterval(async () => {
      attempts++;
      const meta   = this.registry.getMeta(id);
      const status = await this.registry.detectStatus(meta);

      this.post({ command: 'setStatus', id, status });

      if (status === 'ready' || attempts >= maxAttempts) {
        clearInterval(timer);
        this.sendProviderData();

        if (status === 'ready') {
          vscode.window.showInformationMessage(
            `${meta.icon} ${meta.displayName} is ready!`
          );
        }
      }
    }, intervalMs);
  }

  // ── Data ──────────────────────────────────────

  private sendProviderData(): void {
    this.post({
      command:          'providerData',
      providers:        this.registry.getCatalogue(),
      activeProviderID: this.registry.getProviderID(),
    });
  }

  private post(message: unknown): void {
    if (!this.isDisposed) {
      this.panel.webview.postMessage(message);
    }
  }

  // ── HTML ──────────────────────────────────────

  private buildHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <title>Select Provider</title>
  <style>
    /* ── Reset ── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:           var(--vscode-editor-background,            #1e1e1e);
      --bg2:          var(--vscode-sideBar-background,           #252526);
      --bg3:          var(--vscode-list-hoverBackground,         #2a2d2e);
      --fg:           var(--vscode-editor-foreground,            #d4d4d4);
      --fg-muted:     var(--vscode-descriptionForeground,        #858585);
      --fg-subtle:    var(--vscode-disabledForeground,           #555);
      --border:       var(--vscode-panel-border,                 #3c3c3c);
      --focus:        var(--vscode-focusBorder,                  #007fd4);
      --btn:          var(--vscode-button-background,            #0e639c);
      --btn-fg:       var(--vscode-button-foreground,            #fff);
      --btn-hover:    var(--vscode-button-hoverBackground,       #1177bb);
      --btn2:         var(--vscode-button-secondaryBackground,   #3a3d41);
      --btn2-fg:      var(--vscode-button-secondaryForeground,   #ccc);
      --input-bg:     var(--vscode-input-background,             #3c3c3c);
      --input-fg:     var(--vscode-input-foreground,             #d4d4d4);
      --success:      #4ec9b0;
      --warning:      #cca700;
      --error:        #f48771;
      --radius:       8px;
      --font:         var(--vscode-font-family, system-ui, sans-serif);
      --font-size:    var(--vscode-font-size, 13px);
    }

    body {
      font-family: var(--font);
      font-size:   var(--font-size);
      background:  var(--bg);
      color:       var(--fg);
      min-height:  100vh;
      padding:     0;
    }

    /* ── Header ── */
    .header {
      display:         flex;
      align-items:     center;
      justify-content: space-between;
      padding:         16px 20px;
      background:      var(--bg2);
      border-bottom:   1px solid var(--border);
      position:        sticky;
      top:             0;
      z-index:         10;
    }

    .header-title {
      display:     flex;
      align-items: center;
      gap:         10px;
    }

    .header-title h1 {
      font-size:   16px;
      font-weight: 700;
    }

    .header-title p {
      font-size: 11px;
      color:     var(--fg-muted);
      margin-top: 2px;
    }

    .header-actions {
      display: flex;
      gap:     8px;
    }

    /* ── Buttons ── */
    .btn {
      padding:       6px 14px;
      border:        none;
      border-radius: 5px;
      font-family:   var(--font);
      font-size:     12px;
      font-weight:   500;
      cursor:        pointer;
      transition:    all 0.15s;
      display:       inline-flex;
      align-items:   center;
      gap:           5px;
    }

    .btn-primary   { background: var(--btn);  color: var(--btn-fg);  }
    .btn-secondary { background: var(--btn2); color: var(--btn2-fg); }
    .btn-ghost {
      background: transparent;
      color:      var(--fg-muted);
      border:     1px solid var(--border);
    }
    .btn-success {
      background: #1e4a2a;
      color:      var(--success);
      border:     1px solid var(--success);
    }
    .btn-warning {
      background: #3d2e00;
      color:      var(--warning);
      border:     1px solid var(--warning);
    }
    .btn-error {
      background: #3a1818;
      color:      var(--error);
      border:     1px solid var(--error);
    }

    .btn:hover:not(:disabled) { filter: brightness(1.15); }
    .btn:disabled { opacity: 0.45; cursor: not-allowed; }

    /* ── Body layout ── */
    .body {
      padding:               16px 20px;
      display:               grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap:                   14px;
      max-width:             1100px;
      margin:                0 auto;
    }

    /* ── Section labels ── */
    .section-label {
      grid-column:    1 / -1;
      font-size:      11px;
      font-weight:    700;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color:          var(--fg-muted);
      padding:        8px 0 4px;
      border-bottom:  1px solid var(--border);
      margin-top:     8px;
    }

    .section-label:first-child { margin-top: 0; }

    /* ── Provider card ── */
    .card {
      background:    var(--bg2);
      border:        2px solid var(--border);
      border-radius: var(--radius);
      padding:       16px;
      cursor:        pointer;
      transition:    all 0.15s;
      position:      relative;
      display:       flex;
      flex-direction: column;
      gap:           10px;
    }

    .card:hover {
      border-color: var(--focus);
      background:   var(--bg3);
    }

    .card.active {
      border-color: var(--success);
      background:   #1a2e1a;
    }

    .card.active::after {
      content:       '✓ Active';
      position:      absolute;
      top:           10px;
      right:         12px;
      font-size:     10px;
      font-weight:   700;
      color:         var(--success);
      background:    #1e4a2a;
      padding:       2px 8px;
      border-radius: 10px;
    }

    /* ── Card header ── */
    .card-head {
      display:     flex;
      align-items: flex-start;
      gap:         12px;
    }

    .card-icon {
      font-size:   28px;
      line-height: 1;
      flex-shrink: 0;
    }

    .card-info { flex: 1; }

    .card-name {
      font-size:   14px;
      font-weight: 700;
      line-height: 1.2;
      margin-bottom: 3px;
    }

    .card-desc {
      font-size: 11px;
      color:     var(--fg-muted);
      line-height: 1.4;
    }

    /* ── Status badge ── */
    .status-badge {
      display:       inline-flex;
      align-items:   center;
      gap:           5px;
      padding:       3px 9px;
      border-radius: 10px;
      font-size:     10px;
      font-weight:   700;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      width:         fit-content;
    }

    .status-dot {
      width:         6px;
      height:        6px;
      border-radius: 50%;
      flex-shrink:   0;
    }

    .status-ready        { background: #1e4a2a; color: var(--success); }
    .status-ready .status-dot        { background: var(--success); }

    .status-not-installed { background: #2d2d2d; color: var(--fg-muted); }
    .status-not-installed .status-dot { background: var(--fg-muted); }

    .status-not-running  { background: #3d2e00; color: var(--warning); }
    .status-not-running .status-dot  { background: var(--warning); }

    .status-needs-key    { background: #3a1818; color: var(--error); }
    .status-needs-key .status-dot    { background: var(--error); }

    .status-checking     { background: #1e3d70; color: #7eb3ff; }
    .status-checking .status-dot     {
      background: #7eb3ff;
      animation: pulse 1s infinite;
    }

    .status-installing   { background: #1e3d70; color: #7eb3ff; }
    .status-installing .status-dot   {
      background: #7eb3ff;
      animation: pulse 0.5s infinite;
    }

    .status-starting     { background: #3d2e00; color: var(--warning); }
    .status-starting .status-dot     {
      background: var(--warning);
      animation: pulse 0.8s infinite;
    }

    .status-unknown      { background: #2d2d2d; color: var(--fg-subtle); }
    .status-unknown .status-dot      { background: var(--fg-subtle); }

    @keyframes pulse {
      0%, 100% { opacity: 1;   }
      50%       { opacity: 0.3; }
    }

    /* ── Strength tag ── */
    .card-strength {
      font-size:  10px;
      color:      var(--fg-subtle);
      font-style: italic;
      line-height: 1.3;
    }

    /* ── Card actions ── */
    .card-actions {
      display:   flex;
      flex-wrap: wrap;
      gap:       6px;
      margin-top: 2px;
    }

    /* ── Model selector ── */
    .model-select {
      width:         100%;
      background:    var(--input-bg);
      color:         var(--input-fg);
      border:        1px solid var(--border);
      border-radius: 5px;
      padding:       5px 8px;
      font-family:   var(--font);
      font-size:     11px;
      cursor:        pointer;
    }
    .model-select:focus {
      outline:      none;
      border-color: var(--focus);
    }

    /* ── Local badge ── */
    .local-tag {
      display:       inline-block;
      padding:       1px 6px;
      background:    #1a2e1a;
      color:         var(--success);
      border-radius: 4px;
      font-size:     9px;
      font-weight:   700;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      flex-shrink:   0;
    }

    .cloud-tag {
      display:       inline-block;
      padding:       1px 6px;
      background:    #1e3d70;
      color:         #7eb3ff;
      border-radius: 4px;
      font-size:     9px;
      font-weight:   700;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      flex-shrink:   0;
    }

    /* ── Scrollbar ── */
    ::-webkit-scrollbar       { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #424242; border-radius: 3px; }

    /* ── Animations ── */
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .card { animation: fadeIn 0.2s ease-out; }
  </style>
</head>
<body>

  <!-- ── Header ── -->
  <div class="header">
    <div class="header-title">
      <div>
        <h1>🤖 Select AI Provider</h1>
        <p>Choose a provider below — the extension switches instantly.</p>
      </div>
    </div>
    <div class="header-actions">
      <button class="btn btn-secondary" onclick="refreshAll()">
        🔄 Refresh Status
      </button>
    </div>
  </div>

  <!-- ── Provider grid ── -->
  <div class="body" id="providerGrid">
    <div class="section-label">Detecting providers…</div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    let providers        = [];
    let activeProviderID = 'mock';

    // ── Boot ──────────────────────────────────────
    window.addEventListener('load', () => {
      vscode.postMessage({ command: 'ready' });
    });

    // ── Messages from extension ───────────────────
    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.command) {
        case 'providerData':
          providers        = msg.providers;
          activeProviderID = msg.activeProviderID;
          renderGrid();
          break;
        case 'setStatus':
          updateCardStatus(msg.id, msg.status);
          break;
        case 'installProgress':
          updateInstallProgress(msg.id, msg.status);
          break;
        case 'providerSelected':
          activeProviderID = msg.id;
          renderGrid();
          break;
      }
    });

    // ── Render ────────────────────────────────────
    function renderGrid() {
      const grid   = document.getElementById('providerGrid');
      const local  = providers.filter(p => p.isLocal);
      const cloud  = providers.filter(p => !p.isLocal);

      grid.innerHTML =
        renderSection('🖥  Local — No API Key Required', local) +
        renderSection('☁️  Cloud — API Key Required',    cloud);
    }

    function renderSection(title, list) {
      if (!list.length) { return ''; }
      return (
        '<div class="section-label">' + escHtml(title) + '</div>' +
        list.map(renderCard).join('')
      );
    }

    function renderCard(p) {
      const isActive = p.id === activeProviderID;
      const tag      = p.isLocal
        ? '<span class="local-tag">Local</span>'
        : '<span class="cloud-tag">Cloud</span>';

      return (
        '<div class="card' + (isActive ? ' active' : '') + '" ' +
             'id="card-' + p.id + '">' +

          '<div class="card-head">' +
            '<div class="card-icon">' + p.icon + '</div>' +
            '<div class="card-info">' +
              '<div class="card-name">' +
                escHtml(p.displayName) + ' ' + tag +
              '</div>' +
              '<div class="card-desc">' + escHtml(p.description) + '</div>' +
            '</div>' +
          '</div>' +

          renderStatusBadge(p.id, p.status) +

          '<div class="card-strength">' + escHtml(p.strength) + '</div>' +

          renderModelSelector(p) +
          renderActions(p) +

        '</div>'
      );
    }

    function renderStatusBadge(id, status) {
      const labels = {
        'ready':          '● Ready',
        'not-installed':  '○ Not Installed',
        'not-running':    '◐ Not Running',
        'needs-key':      '⚠ Needs API Key',
        'checking':       '… Checking',
        'installing':     '⬇ Installing',
        'starting':       '▶ Starting',
        'unknown':        '? Unknown',
      };
      const label = labels[status] ?? '? Unknown';
      return (
        '<div class="status-badge status-' + status +
        '" id="status-' + id + '">' +
          '<div class="status-dot"></div>' +
          escHtml(label) +
        '</div>'
      );
    }

    function renderModelSelector(p) {
      if (!p.models?.length || p.models.length <= 1) { return ''; }
      const opts = p.models.map(m =>
        '<option value="' + escAttr(m) + '">' + escHtml(m) + '</option>'
      ).join('');
      return (
        '<select class="model-select" ' +
               'onchange="selectModel(\'' + p.id + '\', this.value)">' +
          opts +
        '</select>'
      );
    }

    function renderActions(p) {
      const actions = [];
      const id      = p.id;

      switch (p.status) {
        case 'ready':
          if (id !== activeProviderID) {
            actions.push(btn('✓ Use This Provider', 'btn-success',
              'selectProvider("' + id + '")'));
          }
          break;

        case 'not-installed':
          if (p.installCmd) {
            actions.push(btn('⬇ Auto Install', 'btn-primary',
              'installProvider("' + id + '")'));
          }
          if (p.setupUrl) {
            actions.push(btn('🌐 Download Page', 'btn-ghost',
              'openUrl("' + escAttr(p.setupUrl) + '")'));
          }
          break;

        case 'not-running':
          if (p.startCmd) {
            actions.push(btn('▶ Start Server', 'btn-warning',
              'startProvider("' + id + '")'));
          }
          actions.push(btn('🔄 Recheck', 'btn-ghost',
            'refreshOne("' + id + '")'));
          break;

        case 'needs-key':
          actions.push(btn('🔑 Enter API Key', 'btn-error',
            'enterApiKey("' + id + '")'));
          if (p.setupUrl) {
            actions.push(btn('🌐 Get Key', 'btn-ghost',
              'openUrl("' + escAttr(p.setupUrl) + '")'));
          }
          break;

        case 'checking':
        case 'installing':
        case 'starting':
          actions.push(btn('⏳ Please wait…', 'btn-secondary', '', true));
          break;

        default:
          actions.push(btn('🔄 Check Status', 'btn-ghost',
            'refreshOne("' + id + '")'));
      }

      return '<div class="card-actions">' + actions.join('') + '</div>';
    }

    function btn(label, cls, onclick, disabled) {
      return (
        '<button class="btn ' + cls + '" ' +
        (onclick   ? 'onclick="' + onclick + '"' : '') +
        (disabled  ? ' disabled' : '') +
        '>' + escHtml(label) + '</button>'
      );
    }

    // ── Live status update ────────────────────────
    function updateCardStatus(id, status) {
      // Update badge
      const badge = document.getElementById('status-' + id);
      if (badge) {
        badge.outerHTML = renderStatusBadge(id, status);
      }

      // Re-render the full card for action buttons
      const card = document.getElementById('card-' + id);
      if (card) {
        const p = providers.find(x => x.id === id);
        if (p) {
          p.status = status;
          card.outerHTML = renderCard(p);
        }
      }
    }

    // ── Install progress update ──────────────────
    function updateInstallProgress(id, status) {
      const p = providers.find(x => x.id === id);
      if (!p) return;

      // Map progress status to display status with better messaging
      let displayStatus = status;
      if (status === 'installing') {
        displayStatus = 'installing'; // "⬇ Installing"
      } else if (status === 'checking') {
        displayStatus = 'checking';   // "… Checking"
      } else if (status === 'ready') {
        // Keep whatever status reflects readiness
        displayStatus = 'ready';
      } else if (status === 'failed') {
        displayStatus = 'unknown';    // Show as unknown/error
      }

      // Update just the card status without full re-render
      updateCardStatus(id, displayStatus);
    }

    // ── Global action functions ───────────────────
    function selectProvider(id) {
      vscode.postMessage({ command: 'selectProvider', id });
    }

    function installProvider(id) {
      updateCardStatus(id, 'installing');
      vscode.postMessage({ command: 'installProvider', id });
    }

    function startProvider(id) {
      updateCardStatus(id, 'starting');
      vscode.postMessage({ command: 'startProvider', id });
    }

    function enterApiKey(id) {
      vscode.postMessage({ command: 'enterApiKey', id });
    }

    function openUrl(url) {
      vscode.postMessage({ command: 'openUrl', url });
    }

    function selectModel(id, model) {
      vscode.postMessage({ command: 'selectModel', id, model });
    }

    function refreshAll() {
      providers.forEach(p => { p.status = 'checking'; });
      renderGrid();
      vscode.postMessage({ command: 'refreshStatuses' });
    }

    function refreshOne(id) {
      updateCardStatus(id, 'checking');
      vscode.postMessage({ command: 'refreshStatuses' });
    }

    // ── Utils ─────────────────────────────────────
    function escHtml(str) {
      return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function escAttr(str) {
      return String(str ?? '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    }
  </script>
</body>
</html>`;
  }
}