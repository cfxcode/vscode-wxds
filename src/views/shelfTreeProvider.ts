import * as vscode from 'vscode';
import type { WeReadApiClient } from '../api/wereadApi';
import type { ShelfAlbum, ShelfBook, ShelfSyncResponse } from '../types/weread';
import { computeShelfStats, formatDate } from '../utils/format';

export type ShelfNode =
  | { kind: 'message'; label: string; description?: string; command?: vscode.Command }
  | { kind: 'summary'; label: string; description: string }
  | { kind: 'group'; groupId: 'books' | 'albums' | 'mp'; label: string; count: number }
  | { kind: 'book'; book: ShelfBook }
  | { kind: 'album'; album: ShelfAlbum }
  | { kind: 'mp' };

export class ShelfTreeProvider implements vscode.TreeDataProvider<ShelfNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ShelfNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private cachedShelf: ShelfSyncResponse | undefined;
  private lastError: string | undefined;

  constructor(private readonly api: WeReadApiClient) {}

  getCachedShelf(): ShelfSyncResponse | undefined {
    return this.cachedShelf;
  }

  refresh(): void {
    this.cachedShelf = undefined;
    this.lastError = undefined;
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: ShelfNode): vscode.TreeItem {
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
      item.iconPath = new vscode.ThemeIcon('library');
      return item;
    }

    if (element.kind === 'group') {
      const item = new vscode.TreeItem(
        `${element.label} (${element.count})`,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon(
        element.groupId === 'books'
          ? 'book'
          : element.groupId === 'albums'
            ? 'unmute'
            : 'bookmark',
      );
      return item;
    }

    if (element.kind === 'book') {
      const b = element.book;
      const item = new vscode.TreeItem(b.title, vscode.TreeItemCollapsibleState.None);
      const flags = [
        b.isTop ? '置顶' : '',
        b.finishReading === 1 ? '已读完' : '',
        b.secret === 1 ? '私密' : '',
      ].filter(Boolean);
      const descParts = [b.author || '', flags.join('·')].filter(Boolean);
      item.description = descParts.join(' ｜ ');
      item.tooltip = new vscode.MarkdownString(
        `**${b.title}**\n\n` +
          `- 作者：${b.author || '未知'}\n` +
          `- 分类：${b.category || '未分类'}\n` +
          `- 最近阅读：${formatDate(b.readUpdateTime)}\n` +
          `- 状态：${b.finishReading === 1 ? '已读完' : '在读'} · ${b.secret === 1 ? '私密' : '公开'}`,
      );
      item.iconPath = new vscode.ThemeIcon(b.finishReading === 1 ? 'pass-filled' : 'book');
      item.contextValue = 'wxdsBook';
      item.command = {
        command: 'wxds.openBookDetail',
        title: '查看书籍详情与书评',
        arguments: [element],
      };
      return item;
    }

    if (element.kind === 'album') {
      const info = element.album.albumInfo;
      const extra = element.album.albumInfoExtra;
      const name = info?.name || '未命名专辑';
      const item = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.None);
      item.description = [
        info?.authorName || '',
        info?.trackCount ? `${info.trackCount}集` : '',
        info?.finishStatus || '',
      ]
        .filter(Boolean)
        .join(' ｜ ');
      item.tooltip = new vscode.MarkdownString(
        `**${name}**\n\n` +
          `- 演播/作者：${info?.authorName || '未知'}\n` +
          `- 集数：${info?.trackCount ?? '-'}\n` +
          `- 最近收听：${formatDate(extra?.lectureReadUpdateTime)}\n` +
          `- 隐私：${extra?.secret === 1 ? '私密' : '公开'}`,
      );
      item.iconPath = new vscode.ThemeIcon('unmute');
      item.contextValue = 'wxdsAlbum';
      return item;
    }

    const mpItem = new vscode.TreeItem('文章收藏（入口）', vscode.TreeItemCollapsibleState.None);
    mpItem.description = '私密阅读 · 入口条目';
    mpItem.iconPath = new vscode.ThemeIcon('file-text');
    return mpItem;
  }

  async getChildren(element?: ShelfNode): Promise<ShelfNode[]> {
    if (!element) {
      try {
        if (!this.cachedShelf) {
          this.cachedShelf = await this.api.syncShelf();
          this.lastError = undefined;
        }
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err);
        return [
          {
            kind: 'message',
            label: '无法加载书架（点击配置 API Key）',
            description: this.lastError,
            command: { command: 'wxds.setApiKey', title: '配置 API Key' },
          },
        ];
      }

      const stats = computeShelfStats(this.cachedShelf);
      if (stats.totalVisible === 0) {
        return [{ kind: 'message', label: '你的书架还没有书哦' }];
      }

      const nodes: ShelfNode[] = [
        {
          kind: 'summary',
          label: `书架共 ${stats.totalVisible} 个可见条目`,
          description: `公开 ${stats.publicCount} · 私密 ${stats.privateCount}`,
        },
      ];

      if (stats.bookCount > 0) {
        nodes.push({ kind: 'group', groupId: 'books', label: '电子书', count: stats.bookCount });
      }
      if (stats.albumCount > 0) {
        nodes.push({
          kind: 'group',
          groupId: 'albums',
          label: '有声书 / 专辑',
          count: stats.albumCount,
        });
      }
      if (stats.mpCount > 0) {
        nodes.push({ kind: 'group', groupId: 'mp', label: '文章收藏', count: stats.mpCount });
      }
      return nodes;
    }

    if (element.kind === 'group' && this.cachedShelf) {
      if (element.groupId === 'books') {
        const sorted = [...(this.cachedShelf.books ?? [])].sort(
          (a, b) => (b.readUpdateTime ?? 0) - (a.readUpdateTime ?? 0),
        );
        return sorted.map((book) => ({ kind: 'book', book }));
      }
      if (element.groupId === 'albums') {
        const sorted = [...(this.cachedShelf.albums ?? [])].sort(
          (a, b) =>
            (b.albumInfoExtra?.lectureReadUpdateTime ?? 0) -
            (a.albumInfoExtra?.lectureReadUpdateTime ?? 0),
        );
        return sorted.map((album) => ({ kind: 'album', album }));
      }
      if (element.groupId === 'mp') {
        return [{ kind: 'mp' }];
      }
    }

    return [];
  }
}
