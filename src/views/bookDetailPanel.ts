import * as vscode from 'vscode';
import type { WeReadApiClient } from '../api/wereadApi';
import type {
  BestBookmarksResponse,
  BookInfoResponse,
  BookProgressResponse,
  ChapterInfoResponse,
  PublicReviewsResponse,
} from '../types/weread';
import { escapeHtml, formatDate, formatDuration, formatStar } from '../utils/format';

export interface BookDetailCallbacks {
  onReadExternal: (url: string | undefined) => void;
  onExportNotes: (bookId: string, title: string, author: string, readerLink?: string) => void;
  onFindSimilar: (bookId: string, title: string) => void;
}

const REVIEW_TYPES: Array<{ type: number; label: string }> = [
  { type: 0, label: '全部' },
  { type: 1, label: '推荐' },
  { type: 3, label: '最新' },
  { type: 4, label: '一般' },
  { type: 2, label: '不行' },
];

export class BookDetailPanel {
  private panel: vscode.WebviewPanel | undefined;
  private currentBookId: string | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly api: WeReadApiClient,
    private readonly callbacks: BookDetailCallbacks,
  ) {}

  async open(bookId: string, fallbackTitle?: string): Promise<void> {
    this.currentBookId = bookId;
    const title = fallbackTitle ? `书籍详情 · ${fallbackTitle}` : '书籍详情';

    if (this.panel) {
      this.panel.title = title;
      this.panel.reveal(vscode.ViewColumn.Active);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'wxdsBookDetail',
        title,
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'resources', 'weread-icon.svg');
      panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.panel = panel;
    }

    await this.loadAll(bookId, 0);
  }

  private async loadAll(bookId: string, reviewListType: number): Promise<void> {
    if (!this.panel) {
      return;
    }
    this.panel.webview.html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8" />
      <style>body{font-family:var(--vscode-font-family);background:var(--vscode-editor-background);color:var(--vscode-foreground);padding:24px;}</style>
      </head><body><p>正在加载书籍详情、目录、热门划线与公开书评...</p></body></html>`;

    try {
      const [info, chapterInfo, progress, bestBookmarks, reviews] = await Promise.all([
        this.api.getBookInfo(bookId),
        this.api.getChapterInfo(bookId).catch(() => undefined),
        this.api.getProgress(bookId).catch(() => undefined),
        this.api.getBestBookmarks(bookId).catch(() => undefined),
        this.api.getPublicReviews(bookId, reviewListType, 20, 0, 0).catch(() => undefined),
      ]);

      if (!this.panel || this.currentBookId !== bookId) {
        return;
      }

      const bookTitle = info.title || bookId;
      const author = info.author || '未知';
      const readerLink = info.readerLink || info.deepLink;
      this.panel.title = `详情 · ${bookTitle}`;

      const disposable = this.panel.webview.onDidReceiveMessage(async (msg) => {
        if (!msg || typeof msg !== 'object') {
          return;
        }
        if (msg.type === 'readExternal') {
          this.callbacks.onReadExternal(readerLink);
        } else if (msg.type === 'exportNotes') {
          this.callbacks.onExportNotes(bookId, bookTitle, author, readerLink);
        } else if (msg.type === 'findSimilar') {
          this.callbacks.onFindSimilar(bookId, bookTitle);
        } else if (msg.type === 'filterReviews' && typeof msg.reviewType === 'number') {
          disposable.dispose();
          await this.loadAll(bookId, msg.reviewType);
        }
      });

      this.panel.webview.html = this.renderHtml(
        info,
        chapterInfo,
        progress,
        bestBookmarks,
        reviews,
        reviewListType,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (this.panel) {
        this.panel.webview.html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8" />
          <style>body{font-family:var(--vscode-font-family);background:var(--vscode-editor-background);color:var(--vscode-foreground);padding:24px;}</style>
          </head><body><h3>加载书籍详情失败</h3><p>${escapeHtml(msg)}</p></body></html>`;
      }
    }
  }

  private renderHtml(
    info: BookInfoResponse,
    chapterInfo: ChapterInfoResponse | undefined,
    progress: BookProgressResponse | undefined,
    bestBookmarks: BestBookmarksResponse | undefined,
    reviews: PublicReviewsResponse | undefined,
    reviewListType: number,
  ): string {
    const prog = progress?.book;
    const pct = prog?.progress ?? 0;
    const durSec = prog?.readingTime ?? prog?.recordReadingTime ?? 0;
    const ratingText = info.newRating
      ? `${info.newRating}%${info.newRatingDetail?.title ? `（${info.newRatingDetail.title}）` : ''} · ${info.newRatingCount ?? 0}人评分`
      : '暂无评分';

    const chapters = chapterInfo?.chapters ?? [];
    const chapterHtml =
      chapters.length > 0
        ? `<ul class="chapter-list">${chapters
            .map((ch) => {
              const indent = Math.max(0, (ch.level ?? 1) - 1) * 16;
              const wc = ch.wordCount ? `${ch.wordCount}字` : '';
              return `<li style="padding-left:${indent}px"><span>${escapeHtml(ch.title)}</span><span class="muted">${escapeHtml(wc)}</span></li>`;
            })
            .join('')}</ul>`
        : '<p class="muted">暂无目录数据。</p>';

    const bmChapters = new Map<number, string>();
    for (const c of bestBookmarks?.chapters ?? []) {
      bmChapters.set(c.chapterUid, c.title);
    }
    const bestItems = bestBookmarks?.items ?? [];
    const bestHtml =
      bestItems.length > 0
        ? bestItems
            .map(
              (item, idx) => `<div class="quote-card">
                <div class="quote-head"><span>#${idx + 1} · ${escapeHtml(bmChapters.get(item.chapterUid) || '')}</span><span class="badge">${item.totalCount ?? 0} 人划线</span></div>
                <blockquote>${escapeHtml(item.markText)}</blockquote>
              </div>`,
            )
            .join('')
        : '<p class="muted">暂无热门划线。</p>';

    const reviewButtons = REVIEW_TYPES.map(
      (rt) =>
        `<button class="filter-btn ${rt.type === reviewListType ? 'active' : ''}" data-type="${rt.type}">${rt.label}</button>`,
    ).join('');

    const reviewList = reviews?.reviews ?? [];
    const deepV = reviews?.deepVRecommendInfo
      ? `<p class="muted">${escapeHtml(reviews.deepVRecommendInfo.title || '')} ${escapeHtml(reviews.deepVRecommendInfo.subtitle || '')}</p>`
      : '';
    const reviewHtml =
      reviewList.length > 0
        ? reviewList
            .map((entry) => {
              const inner = entry.review?.review;
              if (!inner) {
                return '';
              }
              const authorName = inner.author?.name || '匿名读者';
              const content = (inner.content || '').trim();
              const shortContent =
                content.length > 350 ? `${content.slice(0, 350)}…` : content || '（无文字内容）';
              return `<div class="review-card">
                <div class="review-head">
                  <strong>${escapeHtml(authorName)}</strong>
                  <span>${formatStar(inner.star)}</span>
                  ${inner.isFinish ? '<span class="badge">已读完</span>' : ''}
                  <span class="muted" style="margin-left:auto">${formatDate(inner.createTime)}</span>
                </div>
                <p>${escapeHtml(shortContent).replace(/\n/g, '<br/>')}</p>
              </div>`;
            })
            .join('')
        : '<p class="muted">这本书暂时还没有此类公开点评。</p>';

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
      max-width: 960px;
      margin: 0 auto;
      line-height: 1.6;
    }
    .hero {
      display: flex;
      gap: 18px;
      padding: 16px;
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      margin-bottom: 18px;
    }
    .cover {
      width: 108px;
      height: 152px;
      object-fit: cover;
      border-radius: 4px;
      background: var(--vscode-editor-background);
      flex-shrink: 0;
    }
    .hero-info { flex: 1; min-width: 0; }
    .hero-info h2 { margin: 0 0 6px; font-size: 20px; }
    .meta { font-size: 13px; opacity: 0.85; margin-bottom: 6px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
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
    .progress-bar {
      height: 6px;
      background: var(--vscode-editor-background);
      border-radius: 3px;
      overflow: hidden;
      margin: 6px 0;
      max-width: 320px;
    }
    .progress-fill { height: 100%; background: var(--vscode-progressBar-background); }
    .section-tabs {
      display: flex;
      gap: 6px;
      border-bottom: 1px solid var(--vscode-panel-border);
      margin-bottom: 14px;
    }
    .stab {
      background: transparent;
      color: var(--vscode-foreground);
      border-radius: 4px 4px 0 0;
      padding: 7px 14px;
      opacity: 0.75;
    }
    .stab.active {
      opacity: 1;
      border-bottom: 2px solid var(--vscode-focusBorder);
      font-weight: 600;
    }
    .pane { display: none; }
    .pane.active { display: block; }
    .chapter-list { list-style: none; padding: 0; margin: 0; }
    .chapter-list li {
      display: flex;
      justify-content: space-between;
      padding: 5px 4px;
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 13px;
    }
    .quote-card, .review-card {
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px 14px;
      margin-bottom: 10px;
    }
    .quote-head, .review-head {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      margin-bottom: 6px;
    }
    blockquote {
      margin: 0;
      padding-left: 10px;
      border-left: 3px solid var(--vscode-focusBorder);
      font-size: 13px;
    }
    .badge {
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 999px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .filter-row { display: flex; gap: 6px; margin-bottom: 12px; }
    .filter-btn {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      padding: 4px 10px;
      font-size: 12px;
    }
    .filter-btn.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .muted { opacity: 0.7; font-size: 12px; }
  </style>
</head>
<body>
  <div class="hero">
    ${info.cover ? `<img class="cover" src="${escapeHtml(info.cover)}" alt="cover" />` : ''}
    <div class="hero-info">
      <h2>${escapeHtml(info.title || info.bookId)}</h2>
      <div class="meta">作者：${escapeHtml(info.author || '未知')}${info.translator ? ` ｜ 译者：${escapeHtml(info.translator)}` : ''}</div>
      <div class="meta">分类：${escapeHtml(info.category || '-')} ｜ 出版社：${escapeHtml(info.publisher || '-')} ｜ 字数：${info.wordCount ? `${info.wordCount.toLocaleString()}字` : '-'}</div>
      <div class="meta">评分：${escapeHtml(ratingText)}</div>
      <div class="meta">个人阅读进度：<strong>${pct}%</strong>（累计 ${escapeHtml(formatDuration(durSec))}，最近阅读：${formatDate(prog?.updateTime)}）</div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="actions">
        <button id="btnExternal">在微信读书网页版阅读</button>
        <button id="btnExport" class="secondary">导出笔记 Markdown</button>
        <button id="btnSimilar" class="secondary">找相似好书</button>
      </div>
    </div>
  </div>

  <div class="section-tabs">
    <button class="stab active" data-pane="paneIntro">简介与目录 (${chapters.length})</button>
    <button class="stab" data-pane="paneBest">热门划线 (${bestItems.length})</button>
    <button class="stab" data-pane="paneReviews">公开书评 (${reviews?.reviewsCnt ?? reviewList.length})</button>
  </div>

  <div id="paneIntro" class="pane active">
    <h3>内容简介</h3>
    <p>${escapeHtml(info.intro || '暂无简介').replace(/\n/g, '<br/>')}</p>
    <h3>章节目录</h3>
    ${chapterHtml}
  </div>

  <div id="paneBest" class="pane">
    ${bestHtml}
  </div>

  <div id="paneReviews" class="pane">
    ${deepV}
    <div class="filter-row">${reviewButtons}</div>
    ${reviewHtml}
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('btnExternal').addEventListener('click', () => vscode.postMessage({ type: 'readExternal' }));
    document.getElementById('btnExport').addEventListener('click', () => vscode.postMessage({ type: 'exportNotes' }));
    document.getElementById('btnSimilar').addEventListener('click', () => vscode.postMessage({ type: 'findSimilar' }));
    document.querySelectorAll('.stab').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.stab').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.pane').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.pane).classList.add('active');
      });
    });
    document.querySelectorAll('.filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'filterReviews', reviewType: Number(btn.dataset.type) });
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
