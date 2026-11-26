import * as vscode from 'vscode';
import type { WeReadApiClient } from '../api/wereadApi';
import type { NotebookItem } from '../types/weread';
import { escapeHtml, formatDate } from '../utils/format';

export interface NoteDetailTarget {
  kind: 'highlight' | 'thought';
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  readerLink?: string;
  notebook?: NotebookItem;
  chapterTitle: string;
  text: string;
  abstract?: string;
  createTime?: number;
}

export interface NoteDetailCallbacks {
  onOpenBookDetail: (bookId: string, title: string) => void;
  onExportNotes: (
    bookId: string,
    title: string,
    author: string,
    readerLink?: string,
    notebook?: NotebookItem,
  ) => void;
  onOpenExternal: (url?: string) => void;
}

export class NoteDetailPanel {
  private panel: vscode.WebviewPanel | undefined;
  private messageDisposable: vscode.Disposable | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly api: WeReadApiClient,
    private readonly callbacks: NoteDetailCallbacks,
  ) {}

  async open(target: NoteDetailTarget): Promise<void> {
    const title = `划线笔记 · ${target.bookTitle}`;

    if (this.panel) {
      this.panel.title = title;
      this.panel.reveal(vscode.ViewColumn.Active);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'wxdsNoteDetail',
        title,
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'resources', 'weread-icon.svg');
      panel.onDidDispose(() => {
        this.messageDisposable?.dispose();
        this.messageDisposable = undefined;
        this.panel = undefined;
      });
      this.panel = panel;
    }

    // Render clicked note immediately so there's zero wait
    this.bindMessages(target);
    this.panel.webview.html = this.renderHtml(target, undefined, undefined);

    // Then enrich with all notes in the same book
    try {
      const [bookmarks, myReviews] = await Promise.all([
        this.api.getBookmarks(target.bookId),
        this.api.getMyReviews(target.bookId),
      ]);
      if (this.panel) {
        const chapterMap = new Map<number, string>();
        for (const c of bookmarks.chapters ?? []) {
          chapterMap.set(c.chapterUid, c.title);
        }
        const allItems: Array<{
          type: 'highlight' | 'thought';
          chapterTitle: string;
          text: string;
          abstract?: string;
          createTime?: number;
        }> = [];
        for (const h of bookmarks.updated ?? []) {
          allItems.push({
            type: 'highlight',
            chapterTitle: chapterMap.get(h.chapterUid) || `章节 ${h.chapterUid}`,
            text: h.markText,
            createTime: h.createTime,
          });
        }
        for (const r of myReviews) {
          const rev = r.review;
          if (!rev?.content) {
            continue;
          }
          allItems.push({
            type: 'thought',
            chapterTitle:
              (rev.chapterUid ? chapterMap.get(rev.chapterUid) : undefined) ||
              rev.chapterName ||
              '整本书评',
            text: rev.content,
            abstract: rev.abstract,
            createTime: rev.createTime,
          });
        }
        this.panel.webview.html = this.renderHtml(target, allItems, undefined);
      }
    } catch (err) {
      if (this.panel) {
        this.panel.webview.html = this.renderHtml(
          target,
          undefined,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  private bindMessages(target: NoteDetailTarget): void {
    this.messageDisposable?.dispose();
    if (!this.panel) {
      return;
    }
    this.messageDisposable = this.panel.webview.onDidReceiveMessage(async (msg) => {
      if (!msg || typeof msg !== 'object') {
        return;
      }
      if (msg.type === 'copy' && typeof msg.text === 'string') {
        await vscode.env.clipboard.writeText(msg.text);
        vscode.window.showInformationMessage('已复制划线/想法内容到剪贴板');
      } else if (msg.type === 'export') {
        this.callbacks.onExportNotes(
          target.bookId,
          target.bookTitle,
          target.bookAuthor,
          target.readerLink,
          target.notebook,
        );
      } else if (msg.type === 'bookDetail') {
        this.callbacks.onOpenBookDetail(target.bookId, target.bookTitle);
      } else if (msg.type === 'openExternal') {
        this.callbacks.onOpenExternal(target.readerLink);
      }
    });
  }

  private renderHtml(
    target: NoteDetailTarget,
    allItems?: Array<{
      type: 'highlight' | 'thought';
      chapterTitle: string;
      text: string;
      abstract?: string;
      createTime?: number;
    }>,
    loadError?: string,
  ): string {
    const typeLabel = target.kind === 'highlight' ? '个人划线' : '个人想法 / 点评';
    const abstractHtml = target.abstract
      ? `<blockquote class="quote-ref">${escapeHtml(target.abstract).replace(/\n/g, '<br/>')}</blockquote>`
      : '';

    const listHtml = allItems
      ? allItems
          .map((item, idx) => {
            const isCurrent =
              item.text.trim() === target.text.trim() && item.type === target.kind;
            return `<div class="note-item ${isCurrent ? 'current' : ''}">
              <div class="note-meta">
                <span class="badge">${item.type === 'highlight' ? '划线' : '想法'}</span>
                <span>#${idx + 1} · ${escapeHtml(item.chapterTitle)}</span>
                <span class="muted" style="margin-left:auto">${formatDate(item.createTime)}</span>
                <button class="mini-btn copy-item" data-text="${escapeHtml(item.text)}">复制</button>
              </div>
              ${item.abstract ? `<blockquote class="quote-ref">${escapeHtml(item.abstract).replace(/\n/g, '<br/>')}</blockquote>` : ''}
              <div class="note-body">${escapeHtml(item.text).replace(/\n/g, '<br/>')}</div>
            </div>`;
          })
          .join('')
      : loadError
        ? `<p class="muted">加载全书笔记失败：${escapeHtml(loadError)}</p>`
        : '<p class="muted">正在加载本书其余划线与想法...</p>';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <style>
    body {
      font-family: var(--vscode-font-family);
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      padding: 20px 24px 48px;
      max-width: 880px;
      margin: 0 auto;
      line-height: 1.7;
    }
    .header {
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 12px;
    }
    h2 { margin: 0 0 4px; font-size: 19px; }
    h3 { margin: 22px 0 10px; font-size: 15px; }
    .muted { opacity: 0.72; font-size: 12px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      padding: 6px 12px;
      cursor: pointer;
      font-size: 13px;
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .mini-btn {
      padding: 2px 8px;
      font-size: 11px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .featured {
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-focusBorder);
      border-radius: 8px;
      padding: 16px 18px;
      margin-bottom: 20px;
    }
    .featured-text {
      font-size: 15px;
      margin: 10px 0 12px;
      padding-left: 12px;
      border-left: 3px solid var(--vscode-focusBorder);
    }
    .note-item {
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px 14px;
      margin-bottom: 10px;
    }
    .note-item.current {
      border-color: var(--vscode-focusBorder);
    }
    .note-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      margin-bottom: 8px;
    }
    .badge {
      font-size: 11px;
      padding: 1px 7px;
      border-radius: 999px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .quote-ref {
      margin: 6px 0 8px;
      padding-left: 10px;
      border-left: 3px solid var(--vscode-panel-border);
      opacity: 0.85;
      font-size: 13px;
    }
    .note-body { font-size: 14px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h2>${escapeHtml(target.bookTitle)}</h2>
      <div class="muted">作者：${escapeHtml(target.bookAuthor || '未知')} ｜ 章节：${escapeHtml(target.chapterTitle)}</div>
    </div>
    <div class="actions">
      <button id="btnCopyMain">复制当前内容</button>
      <button id="btnExport" class="secondary">导出本书 Markdown</button>
      <button id="btnBookDetail" class="secondary">查看书籍详情</button>
      ${target.readerLink ? '<button id="btnExternal" class="secondary">网页版阅读</button>' : ''}
    </div>
  </div>

  <section class="featured">
    <div class="note-meta">
      <span class="badge">${typeLabel}</span>
      <span>${escapeHtml(target.chapterTitle)}</span>
      <span class="muted" style="margin-left:auto">${formatDate(target.createTime)}</span>
    </div>
    ${abstractHtml}
    <div class="featured-text">${escapeHtml(target.text).replace(/\n/g, '<br/>')}</div>
  </section>

  <h3>本书全部划线与想法${allItems ? ` (${allItems.length})` : ''}</h3>
  ${listHtml}

  <script>
    const vscode = acquireVsCodeApi();
    const mainText = ${JSON.stringify(target.text)};
    document.getElementById('btnCopyMain').addEventListener('click', () => {
      vscode.postMessage({ type: 'copy', text: mainText });
    });
    document.getElementById('btnExport').addEventListener('click', () => {
      vscode.postMessage({ type: 'export' });
    });
    document.getElementById('btnBookDetail').addEventListener('click', () => {
      vscode.postMessage({ type: 'bookDetail' });
    });
    const extBtn = document.getElementById('btnExternal');
    if (extBtn) {
      extBtn.addEventListener('click', () => vscode.postMessage({ type: 'openExternal' }));
    }
    document.querySelectorAll('.copy-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'copy', text: btn.dataset.text || '' });
      });
    });
  </script>
</body>
</html>`;
  }

  dispose(): void {
    this.messageDisposable?.dispose();
    this.panel?.dispose();
  }
}
