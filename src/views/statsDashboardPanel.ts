import * as vscode from 'vscode';
import type { WeReadApiClient } from '../api/wereadApi';
import type { ReadDataMode, ReadDataResponse } from '../types/weread';
import { escapeHtml, formatDate, formatDuration } from '../utils/format';

const MODE_LABELS: Record<ReadDataMode, string> = {
  weekly: '本周',
  monthly: '本月',
  annually: '本年',
  overall: '全部总计',
};

export class StatsDashboardPanel {
  private panel: vscode.WebviewPanel | undefined;
  private currentMode: ReadDataMode = 'monthly';

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly api: WeReadApiClient,
    private readonly onOpenBook: (bookId: string, title?: string, readerLink?: string) => void,
  ) {}

  async open(initialMode: ReadDataMode = 'monthly'): Promise<void> {
    this.currentMode = initialMode;
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      await this.loadAndRender(initialMode);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'wxdsStatsDashboard',
      '微信读书 · 阅读统计与偏好分析',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'resources', 'weread-icon.svg');

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (!msg || typeof msg !== 'object') {
        return;
      }
      if (msg.type === 'switchMode' && typeof msg.mode === 'string') {
        const mode = msg.mode as ReadDataMode;
        this.currentMode = mode;
        await this.loadAndRender(mode);
      } else if (msg.type === 'openBook' && typeof msg.bookId === 'string') {
        this.onOpenBook(msg.bookId, msg.title, msg.readerLink);
      }
    });

    panel.onDidDispose(() => {
      this.panel = undefined;
    });

    this.panel = panel;
    await this.loadAndRender(initialMode);
  }

  private async loadAndRender(mode: ReadDataMode): Promise<void> {
    if (!this.panel) {
      return;
    }
    this.panel.webview.html = this.renderLoading(mode);
    try {
      const data = await this.api.getReadData(mode);
      if (this.panel) {
        this.panel.webview.html = this.renderDashboard(mode, data);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (this.panel) {
        this.panel.webview.html = this.renderError(mode, msg);
      }
    }
  }

  private renderTabs(activeMode: ReadDataMode): string {
    return (['weekly', 'monthly', 'annually', 'overall'] as ReadDataMode[])
      .map(
        (m) =>
          `<button class="tab ${m === activeMode ? 'active' : ''}" data-mode="${m}">${MODE_LABELS[m]}</button>`,
      )
      .join('');
  }

  private renderLoading(mode: ReadDataMode): string {
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8" />
    <style>body{font-family:var(--vscode-font-family);background:var(--vscode-editor-background);color:var(--vscode-foreground);padding:24px;}</style>
    </head><body><p>正在加载「${MODE_LABELS[mode]}」阅读数据...</p></body></html>`;
  }

  private renderError(mode: ReadDataMode, message: string): string {
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8" />
    <style>body{font-family:var(--vscode-font-family);background:var(--vscode-editor-background);color:var(--vscode-foreground);padding:24px;}</style>
    </head><body><h3>加载「${MODE_LABELS[mode]}」阅读数据失败</h3><p>${escapeHtml(message)}</p></body></html>`;
  }

  private renderDashboard(mode: ReadDataMode, data: ReadDataResponse): string {
    const totalSec = data.totalReadTime ?? 0;
    const readDays = data.readDays ?? 0;
    const avgSec = data.dayAverageReadTime;
    const activeDayAvg = readDays > 0 ? Math.floor(totalSec / readDays) : 0;

    let compareText = '-';
    if (typeof data.compare === 'number') {
      const pct = Math.round(data.compare * 100);
      compareText = pct >= 0 ? `↑ +${pct}%` : `↓ ${pct}%`;
    }

    const statsChips = (data.readStat ?? [])
      .map(
        (s) =>
          `<div class="chip"><span class="chip-label">${escapeHtml(s.stat || '')}</span><strong>${escapeHtml(s.counts || '')}</strong></div>`,
      )
      .join('');

    const longest = data.readLongest ?? [];
    const maxBookSec = Math.max(1, ...longest.map((item) => item.readTime ?? 0));
    const longestRows =
      longest.length > 0
        ? longest
            .map((item, idx) => {
              const title = item.book?.title || item.albumInfo?.name || '未知作品';
              const author = item.book?.author || item.albumInfo?.authorName || '';
              const sec = item.readTime ?? 0;
              const widthPct = Math.max(4, Math.round((sec / maxBookSec) * 100));
              const tags = (item.tags ?? [])
                .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
                .join('');
              const bookIdAttr = item.book?.bookId ? escapeHtml(item.book.bookId) : '';
              const linkAttr = item.book?.readerLink ? escapeHtml(item.book.readerLink) : '';
              return `<div class="bar-row ${bookIdAttr ? 'clickable' : ''}" data-bookid="${bookIdAttr}" data-title="${escapeHtml(title)}" data-link="${linkAttr}">
                <div class="bar-meta">
                  <span class="rank">${idx + 1}.</span>
                  <span class="title">${escapeHtml(title)}</span>
                  <span class="sub">${escapeHtml(author)}</span>
                  ${tags}
                  <span class="val">${escapeHtml(formatDuration(sec))}</span>
                </div>
                <div class="bar-track"><div class="bar-fill" style="width:${widthPct}%"></div></div>
              </div>`;
            })
            .join('')
        : '<p class="muted">当前周期暂无阅读排行数据（单本低于 5 分钟不计入排行）。</p>';

    const cats = (data.preferCategory ?? []).filter((c) => (c.readingTime ?? 0) > 0);
    const maxCatSec = Math.max(1, ...cats.map((c) => c.readingTime ?? 0));
    const categoryRows =
      cats.length > 0
        ? cats
            .map((c) => {
              const sec = c.readingTime ?? 0;
              const widthPct = Math.max(4, Math.round((sec / maxCatSec) * 100));
              return `<div class="bar-row">
                <div class="bar-meta">
                  <span class="title">${escapeHtml(c.categoryTitle || '未分类')}</span>
                  <span class="sub">${c.readingCount ?? 0} 本</span>
                  <span class="val">${escapeHtml(formatDuration(sec))}</span>
                </div>
                <div class="bar-track"><div class="bar-fill accent" style="width:${widthPct}%"></div></div>
              </div>`;
            })
            .join('')
        : '<p class="muted">暂无分类偏好数据。</p>';

    const authors = data.preferAuthor ?? [];
    const authorHtml =
      authors.length > 0
        ? `<section class="card"><h3>偏好作者</h3><div class="chips">${authors
            .map(
              (a) =>
                `<div class="chip"><strong>${escapeHtml(a.name || '')}</strong><span class="chip-label">${a.count ?? 0}本 · ${escapeHtml(a.readTime || '')}</span></div>`,
            )
            .join('')}</div></section>`
        : '';

    const publishers = data.preferPublisher ?? [];
    const publisherHtml =
      publishers.length > 0
        ? `<section class="card"><h3>偏好出版社</h3><div class="chips">${publishers
            .map(
              (p) =>
                `<div class="chip"><strong>${escapeHtml(p.name || '')}</strong><span class="chip-label">${p.count ?? 0}本</span></div>`,
            )
            .join('')}</div></section>`
        : '';

    const extraNotes = [
      data.preferCategoryWord ? `分类偏好：${data.preferCategoryWord}` : '',
      data.preferTimeWord ? `时段偏好：${data.preferTimeWord}` : '',
      data.rank?.text ? `本周好友排行：${data.rank.text}` : '',
      data.readRate !== undefined
        ? `文字阅读占比：${data.readRate}%（文字 ${formatDuration(data.wrReadTime)} / 听书 ${formatDuration(data.wrListenTime)}）`
        : '',
      data.registTime ? `账号注册：${formatDate(data.registTime)}` : '',
    ].filter(Boolean);

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <style>
    body {
      font-family: var(--vscode-font-family);
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      padding: 20px 24px 40px;
      max-width: 960px;
      margin: 0 auto;
      line-height: 1.5;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 18px;
    }
    h2 { margin: 0; font-size: 20px; }
    h3 { margin: 0 0 12px; font-size: 15px; }
    .tabs { display: flex; gap: 6px; }
    .tab {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: 1px solid var(--vscode-panel-border);
      padding: 5px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
    }
    .tab.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .card {
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 14px 16px;
      margin-bottom: 14px;
    }
    .kpi-label { font-size: 12px; opacity: 0.75; }
    .kpi-val { font-size: 22px; font-weight: 600; margin-top: 4px; }
    .kpi-sub { font-size: 11px; opacity: 0.7; margin-top: 2px; }
    .chips { display: flex; flex-wrap: wrap; gap: 10px; }
    .chip {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 6px 12px;
      display: flex;
      gap: 8px;
      align-items: baseline;
      font-size: 13px;
    }
    .chip-label { opacity: 0.75; font-size: 12px; }
    .bar-row { margin-bottom: 10px; padding: 4px 6px; border-radius: 4px; }
    .bar-row.clickable { cursor: pointer; }
    .bar-row.clickable:hover { background: var(--vscode-list-hoverBackground); }
    .bar-meta { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 4px; }
    .rank { opacity: 0.7; width: 20px; }
    .title { font-weight: 500; }
    .sub { opacity: 0.7; font-size: 12px; }
    .val { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 500; }
    .tag {
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 999px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .bar-track {
      height: 7px;
      background: var(--vscode-editor-background);
      border-radius: 4px;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      background: var(--vscode-progressBar-background);
      border-radius: 4px;
    }
    .bar-fill.accent {
      background: var(--vscode-charts-green, var(--vscode-progressBar-background));
    }
    .muted { opacity: 0.7; font-size: 13px; }
    .meta-list { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; opacity: 0.85; }
  </style>
</head>
<body>
  <header>
    <div>
      <h2>阅读统计与偏好分析 · ${MODE_LABELS[mode]}</h2>
      <div class="muted">${mode === 'overall' ? '全部历史统计' : `统计起点：${formatDate(data.baseTime)}`}</div>
    </div>
    <div class="tabs">${this.renderTabs(mode)}</div>
  </header>

  <div class="kpi-grid">
    <div class="card">
      <div class="kpi-label">总阅读 / 收听时长</div>
      <div class="kpi-val">${escapeHtml(formatDuration(totalSec))}</div>
    </div>
    <div class="card">
      <div class="kpi-label">有效阅读天数</div>
      <div class="kpi-val">${readDays} 天</div>
      <div class="kpi-sub">阅读日均约 ${escapeHtml(formatDuration(activeDayAvg))}</div>
    </div>
    <div class="card">
      <div class="kpi-label">自然日均时长</div>
      <div class="kpi-val">${escapeHtml(avgSec !== undefined ? formatDuration(avgSec) : '-')}</div>
      <div class="kpi-sub">较上期：${escapeHtml(compareText)}</div>
    </div>
  </div>

  ${statsChips ? `<section class="card"><h3>阅读统计摘要</h3><div class="chips">${statsChips}</div></section>` : ''}

  ${extraNotes.length > 0 ? `<section class="card"><div class="meta-list">${extraNotes.map((n) => `<span>${escapeHtml(n)}</span>`).join('')}</div></section>` : ''}

  <section class="card">
    <h3>读书时长排行（点击电子书查看详情）</h3>
    ${longestRows}
  </section>

  <section class="card">
    <h3>偏好分类分布</h3>
    ${categoryRows}
  </section>

  ${authorHtml}
  ${publisherHtml}

  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'switchMode', mode: btn.dataset.mode });
      });
    });
    document.querySelectorAll('.bar-row.clickable').forEach((row) => {
      row.addEventListener('click', () => {
        if (row.dataset.bookid) {
          vscode.postMessage({
            type: 'openBook',
            bookId: row.dataset.bookid,
            title: row.dataset.title,
            readerLink: row.dataset.link,
          });
        }
      });
    });
  </script>
</body>
</html>`;
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
