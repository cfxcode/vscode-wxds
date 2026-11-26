import * as vscode from 'vscode';
import type { WeReadApiClient } from '../api/wereadApi';
import type { NotebookItem } from '../types/weread';
import { computeNotebookTotal, formatDate } from '../utils/format';

export type NotesNode =
  | { kind: 'message'; label: string; description?: string; command?: vscode.Command }
  | { kind: 'summary'; label: string; description: string }
  | { kind: 'notebook'; notebook: NotebookItem }
  | {
      kind: 'highlight';
      bookId: string;
      bookTitle: string;
      bookAuthor: string;
      readerLink?: string;
      notebook: NotebookItem;
      chapterTitle: string;
      text: string;
      createTime?: number;
    }
  | {
      kind: 'thought';
      bookId: string;
      bookTitle: string;
      bookAuthor: string;
      readerLink?: string;
      notebook: NotebookItem;
      chapterTitle: string;
      text: string;
      abstract?: string;
      createTime?: number;
    };

export class NotesTreeProvider implements vscode.TreeDataProvider<NotesNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<NotesNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private cachedNotebooks:
    | { totalBookCount: number; totalNoteCount: number; books: NotebookItem[] }
    | undefined;

  constructor(private readonly api: WeReadApiClient) {}

  getCachedNotebooks() {
    return this.cachedNotebooks;
  }

  refresh(): void {
    this.cachedNotebooks = undefined;
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: NotesNode): vscode.TreeItem {
    if (element.kind === 'message') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description;
      item.iconPath = new vscode.ThemeIcon('info');
      item.command = element.command;
      return item;
    }

    if (element.kind === 'summary') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description;
      item.iconPath = new vscode.ThemeIcon('notebook');
      return item;
    }

    if (element.kind === 'notebook') {
      const nb = element.notebook;
      const total = computeNotebookTotal(nb);
      const title = nb.book?.title || nb.bookId;
      const item = new vscode.TreeItem(title, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = `${total}条 (划线${nb.noteCount ?? 0}·想法${nb.reviewCount ?? 0}·书签${nb.bookmarkCount ?? 0})`;
      item.tooltip = new vscode.MarkdownString(
        `**${title}**\n\n` +
          `- 作者：${nb.book?.author || '未知'}\n` +
          `- 总笔记数：${total} 条（划线 ${nb.noteCount ?? 0} / 想法点评 ${nb.reviewCount ?? 0} / 书签 ${nb.bookmarkCount ?? 0}）\n` +
          `- 阅读进度：${nb.readingProgress ?? 0}%\n` +
          `- 最近笔记：${formatDate(nb.sort)}`,
      );
      item.iconPath = new vscode.ThemeIcon('note');
      item.contextValue = 'wxdsNotebook';
      return item;
    }

    if (element.kind === 'highlight') {
      const preview = element.text.replace(/\s+/g, ' ').slice(0, 48);
      const item = new vscode.TreeItem(
        preview + (element.text.length > 48 ? '…' : ''),
        vscode.TreeItemCollapsibleState.None,
      );
      item.description = `${element.chapterTitle} · ${formatDate(element.createTime)}`;
      item.tooltip = new vscode.MarkdownString(
        `**[划线] ${element.chapterTitle}**（${formatDate(element.createTime)}）\n\n> ${element.text}\n\n_点击查看完整内容与复制_`,
      );
      item.iconPath = new vscode.ThemeIcon('quote');
      item.command = {
        command: 'wxds.viewNoteDetail',
        title: '查看划线详情',
        arguments: [element],
      };
      return item;
    }

    const preview = element.text.replace(/\s+/g, ' ').slice(0, 48);
    const item = new vscode.TreeItem(
      preview + (element.text.length > 48 ? '…' : ''),
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = `想法 · ${element.chapterTitle} · ${formatDate(element.createTime)}`;
    const quote = element.abstract ? `> ${element.abstract}\n\n` : '';
    item.tooltip = new vscode.MarkdownString(
      `**[想法/点评] ${element.chapterTitle}**（${formatDate(element.createTime)}）\n\n${quote}${element.text}\n\n_点击查看完整内容与复制_`,
    );
    item.iconPath = new vscode.ThemeIcon('comment');
    item.command = {
      command: 'wxds.viewNoteDetail',
      title: '查看想法详情',
      arguments: [element],
    };
    return item;
  }

  async getChildren(element?: NotesNode): Promise<NotesNode[]> {
    if (!element) {
      try {
        if (!this.cachedNotebooks) {
          this.cachedNotebooks = await this.api.getAllNotebooks();
        }
      } catch (err) {
        return [
          {
            kind: 'message',
            label: '无法加载笔记本（点击配置 API Key）',
            description: err instanceof Error ? err.message : String(err),
            command: { command: 'wxds.setApiKey', title: '配置 API Key' },
          },
        ];
      }

      const { totalBookCount, totalNoteCount, books } = this.cachedNotebooks;
      if (books.length === 0) {
        return [{ kind: 'message', label: '暂无读书笔记或划线' }];
      }

      const sorted = [...books].sort((a, b) => {
        const diff = computeNotebookTotal(b) - computeNotebookTotal(a);
        return diff !== 0 ? diff : (b.sort ?? 0) - (a.sort ?? 0);
      });

      return [
        {
          kind: 'summary',
          label: `共 ${totalBookCount} 本有笔记`,
          description: `合计 ${totalNoteCount} 条`,
        },
        ...sorted.map((notebook): NotesNode => ({ kind: 'notebook', notebook })),
      ];
    }

    if (element.kind === 'notebook') {
      const nb = element.notebook;
      const bookId = nb.bookId;
      const bookTitle = nb.book?.title || bookId;
      const bookAuthor = nb.book?.author || '';
      const readerLink = nb.book?.readerLink || nb.book?.deepLink;

      try {
        const [bm, reviews] = await Promise.all([
          this.api.getBookmarks(bookId),
          this.api.getMyReviews(bookId),
        ]);
        const chapterMap = new Map<number, string>();
        for (const c of bm.chapters ?? []) {
          chapterMap.set(c.chapterUid, c.title);
        }

        const resolvedLink = readerLink || bm.book?.readerLink || bm.book?.deepLink;
        const children: NotesNode[] = [];
        for (const h of bm.updated ?? []) {
          children.push({
            kind: 'highlight',
            bookId,
            bookTitle,
            bookAuthor,
            readerLink: resolvedLink,
            notebook: nb,
            chapterTitle: chapterMap.get(h.chapterUid) || `章节 ${h.chapterUid}`,
            text: h.markText,
            createTime: h.createTime,
          });
        }
        for (const r of reviews) {
          const rev = r.review;
          if (!rev?.content) {
            continue;
          }
          children.push({
            kind: 'thought',
            bookId,
            bookTitle,
            bookAuthor,
            readerLink: resolvedLink,
            notebook: nb,
            chapterTitle:
              (rev.chapterUid ? chapterMap.get(rev.chapterUid) : undefined) ||
              rev.chapterName ||
              '整本书评',
            text: rev.content,
            abstract: rev.abstract,
            createTime: rev.createTime,
          });
        }

        if (children.length === 0) {
          return [{ kind: 'message', label: '该书暂无可展示的划线或想法（书签暂不支持内容导出）' }];
        }
        return children;
      } catch (err) {
        return [
          {
            kind: 'message',
            label: '加载划线失败',
            description: err instanceof Error ? err.message : String(err),
          },
        ];
      }
    }

    return [];
  }
}
