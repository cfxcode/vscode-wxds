import * as vscode from 'vscode';
import { toLocalProxyUrl, WeReadProxyServer } from '../proxy/wereadProxy';
import { escapeHtml } from '../utils/format';

export class ReaderPanelManager {
  private panel: vscode.WebviewPanel | undefined;
  private proxy: WeReadProxyServer;
  private lastTargetUrl = 'https://weread.qq.com/';
  private lastTitle: string | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {
    this.proxy = new WeReadProxyServer(this.readStyleConfig());
  }

  private readConfig() {
    const cfg = vscode.workspace.getConfiguration('wxds');
    return {
      tabTitle: cfg.get<string>('readerTabTitle', '微信读书').trim() || '微信读书',
      showTabLogo: cfg.get<boolean>('showTabLogo', true),
      opacity: cfg.get<number>('readerOpacity', 1),
      hideScrollbar: cfg.get<boolean>('hideScrollbar', false),
      proxyPort: cfg.get<number>('proxyPort', 0),
    };
  }

  private readStyleConfig() {
    const cfg = this.readConfig();
    return { opacity: cfg.opacity, hideScrollbar: cfg.hideScrollbar };
  }

  onConfigurationChanged(): void {
    const cfg = this.readConfig();
    this.proxy.updateOptions({ opacity: cfg.opacity, hideScrollbar: cfg.hideScrollbar });
    if (this.panel) {
      this.panel.title = this.resolveTabTitle(this.lastTitle, cfg.tabTitle);
      this.panel.iconPath = cfg.showTabLogo
        ? vscode.Uri.joinPath(this.extensionUri, 'resources', 'weread-icon.svg')
        : undefined;
      void this.renderCurrentUrl();
    }
  }

  private resolveTabTitle(bookTitle: string | undefined, configuredTitle: string): string {
    if (configuredTitle !== '微信读书') {
      // User customized a stealth tab title like "utils.ts"
      return configuredTitle;
    }
    return bookTitle ? `微信读书 - ${bookTitle}` : configuredTitle;
  }

  async open(targetUrl?: string, bookTitle?: string): Promise<void> {
    if (targetUrl) {
      this.lastTargetUrl = targetUrl;
    }
    if (bookTitle !== undefined) {
      this.lastTitle = bookTitle;
    }

    const cfg = this.readConfig();
    this.proxy.updateOptions({ opacity: cfg.opacity, hideScrollbar: cfg.hideScrollbar });
    await this.proxy.ensureStarted(cfg.proxyPort);

    if (this.panel) {
      this.panel.title = this.resolveTabTitle(this.lastTitle, cfg.tabTitle);
      this.panel.reveal(vscode.ViewColumn.Active);
      await this.renderCurrentUrl();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'wxdsReader',
      this.resolveTabTitle(this.lastTitle, cfg.tabTitle),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    if (cfg.showTabLogo) {
      panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'resources', 'weread-icon.svg');
    }

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (!msg || typeof msg !== 'object') {
        return;
      }
      if (msg.type === 'openExternal') {
        await vscode.env.openExternal(vscode.Uri.parse(this.lastTargetUrl));
      } else if (msg.type === 'goHome') {
        this.lastTargetUrl = 'https://weread.qq.com/';
        this.lastTitle = undefined;
        panel.title = this.resolveTabTitle(undefined, this.readConfig().tabTitle);
        await this.renderCurrentUrl();
      } else if (msg.type === 'reload') {
        await this.renderCurrentUrl();
      } else if (msg.type === 'hide') {
        panel.dispose();
      } else if (msg.type === 'setOpacity' && typeof msg.value === 'number') {
        await vscode.workspace
          .getConfiguration('wxds')
          .update('readerOpacity', msg.value, vscode.ConfigurationTarget.Global);
      }
    });

    panel.onDidDispose(() => {
      this.panel = undefined;
    });

    this.panel = panel;
    await this.renderCurrentUrl();
  }

  async toggle(): Promise<void> {
    if (this.panel) {
      this.panel.dispose();
      this.panel = undefined;
    } else {
      await this.open(this.lastTargetUrl, this.lastTitle);
    }
  }

  private async renderCurrentUrl(): Promise<void> {
    if (!this.panel) {
      return;
    }
    const localOrigin = this.proxy.getLocalOrigin();
    const externalOriginUri = await vscode.env.asExternalUri(vscode.Uri.parse(localOrigin));
    const externalOrigin = externalOriginUri.toString().replace(/\/$/, '');
    const iframeUrl = toLocalProxyUrl(this.lastTargetUrl, externalOrigin);
    const cfg = this.readConfig();
    const opacity = Math.max(0.15, Math.min(1, cfg.opacity));

    this.panel.webview.html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
    }
    .toolbar {
      height: 30px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
      font-size: 12px;
      background: var(--vscode-editorGroupHeader-tabsBackground);
      border-bottom: 1px solid var(--vscode-panel-border);
      user-select: none;
    }
    .toolbar button {
      background: transparent;
      color: var(--vscode-foreground);
      border: 1px solid transparent;
      border-radius: 3px;
      padding: 2px 7px;
      cursor: pointer;
      font-size: 12px;
    }
    .toolbar button:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }
    .spacer { flex: 1; }
    .opacity-wrap {
      display: flex;
      align-items: center;
      gap: 4px;
      opacity: 0.85;
    }
    .opacity-wrap input[type="range"] {
      width: 72px;
      accent-color: var(--vscode-focusBorder);
    }
    iframe {
      width: 100%;
      height: calc(100% - 30px);
      border: none;
      opacity: ${opacity};
      background: #fff;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="btnHome" title="返回微信读书首页">书架首页</button>
    <button id="btnReload" title="刷新当前页">刷新</button>
    <button id="btnExternal" title="使用系统浏览器打开">浏览器打开</button>
    <span class="spacer"></span>
    <label class="opacity-wrap" title="调节阅读器透明度">
      透明度
      <input id="opacityRange" type="range" min="0.15" max="1" step="0.05" value="${opacity}" />
    </label>
    <button id="btnHide" title="老板键隐藏 (Alt+Shift+W)">隐藏</button>
  </div>
  <iframe
    id="readerFrame"
    src="${escapeHtml(iframeUrl)}"
    sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
    allow="clipboard-read; clipboard-write"
  ></iframe>
  <script>
    const vscode = acquireVsCodeApi();
    const frame = document.getElementById('readerFrame');
    document.getElementById('btnHome').addEventListener('click', () => vscode.postMessage({ type: 'goHome' }));
    document.getElementById('btnReload').addEventListener('click', () => vscode.postMessage({ type: 'reload' }));
    document.getElementById('btnExternal').addEventListener('click', () => vscode.postMessage({ type: 'openExternal' }));
    document.getElementById('btnHide').addEventListener('click', () => vscode.postMessage({ type: 'hide' }));
    const range = document.getElementById('opacityRange');
    range.addEventListener('input', () => {
      frame.style.opacity = range.value;
    });
    range.addEventListener('change', () => {
      vscode.postMessage({ type: 'setOpacity', value: parseFloat(range.value) });
    });
  </script>
</body>
</html>`;
  }

  dispose(): void {
    this.panel?.dispose();
    this.proxy.dispose();
  }
}
