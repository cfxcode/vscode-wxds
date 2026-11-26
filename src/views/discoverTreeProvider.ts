import * as vscode from 'vscode';
import type { WeReadApiClient } from '../api/wereadApi';
import type { RecommendBook } from '../types/weread';

export type DiscoverNode =
  | { kind: 'searchAction' }
  | { kind: 'message'; label: string; description?: string; command?: vscode.Command }
  | { kind: 'recommend'; book: RecommendBook };

export class DiscoverTreeProvider implements vscode.TreeDataProvider<DiscoverNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<DiscoverNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private cachedBooks: RecommendBook[] | undefined;

  constructor(private readonly api: WeReadApiClient) {}

  refresh(): void {
    this.cachedBooks = undefined;
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: DiscoverNode): vscode.TreeItem {
    if (element.kind === 'searchAction') {
      const item = new vscode.TreeItem('书城多维搜索...', vscode.TreeItemCollapsibleState.None);
      item.description = '电子书 / 网文 / 听书 / 全文 / 作者';
      item.iconPath = new vscode.ThemeIcon('search');
      item.command = { command: 'wxds.searchStore', title: '书城多维搜索' };
      return item;
    }

    if (element.kind === 'message') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description;
      item.iconPath = new vscode.ThemeIcon('info');
      item.command = element.command;
      return item;
    }

    const b = element.book;
    const title = b.title || b.bookId;
    const item = new vscode.TreeItem(title, vscode.TreeItemCollapsibleState.None);
    const ratingStr = b.newRating ? `${b.newRating}%` : '';
    item.description = [b.author || '', ratingStr, b.newRatingDetail?.title || '']
      .filter(Boolean)
      .join(' · ');
    item.tooltip = new vscode.MarkdownString(
      `**${title}**\n\n` +
        `- 作者：${b.author || '未知'}\n` +
        `- 分类：${b.category || '-'}\n` +
        `- 推荐理由：${b.reason || '个性化推荐'}\n\n` +
        `${(b.intro || '').slice(0, 180)}`,
    );
    item.iconPath = new vscode.ThemeIcon('sparkle');
    item.contextValue = 'wxdsRecommendBook';
    item.command = {
      command: 'wxds.openBookDetail',
      title: '查看书籍详情',
      arguments: [element],
    };
    return item;
  }

  async getChildren(element?: DiscoverNode): Promise<DiscoverNode[]> {
    if (element) {
      return [];
    }

    const nodes: DiscoverNode[] = [{ kind: 'searchAction' }];

    try {
      if (!this.cachedBooks) {
        const resp = await this.api.getRecommendations('在 VS Code 侧边栏查看个性化推荐好书', 12, 0);
        this.cachedBooks = resp.books ?? [];
      }
      if (this.cachedBooks.length === 0) {
        nodes.push({ kind: 'message', label: '暂时没有推荐书籍' });
      } else {
        nodes.push(...this.cachedBooks.map((book): DiscoverNode => ({ kind: 'recommend', book })));
      }
    } catch (err) {
      nodes.push({
        kind: 'message',
        label: '无法加载推荐（点击配置 API Key）',
        description: err instanceof Error ? err.message : String(err),
        command: { command: 'wxds.setApiKey', title: '配置 API Key' },
      });
    }

    return nodes;
  }
}
