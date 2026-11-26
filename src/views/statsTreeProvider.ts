import * as vscode from 'vscode';
import type { WeReadApiClient } from '../api/wereadApi';
import type { BookProgressResponse, ReadDataResponse, ShelfBook } from '../types/weread';
import { formatDate, formatDuration } from '../utils/format';

export type StatsNode =
  | { kind: 'action'; label: string; description?: string; icon: string; command: vscode.Command }
  | { kind: 'metric'; label: string; description: string; icon: string; tooltip?: string }
  | { kind: 'recentGroup' }
  | { kind: 'recentBook'; book: ShelfBook; progress: BookProgressResponse };

export class StatsTreeProvider implements vscode.TreeDataProvider<StatsNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<StatsNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private monthly: ReadDataResponse | undefined;
  private annually: ReadDataResponse | undefined;
  private overall: ReadDataResponse | undefined;
  private recentProgress: Array<{ book: ShelfBook; progress: BookProgressResponse }> | undefined;

  constructor(private readonly api: WeReadApiClient) {}

  refresh(): void {
    this.monthly = undefined;
    this.annually = undefined;
    this.overall = undefined;
    this.recentProgress = undefined;
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: StatsNode): vscode.TreeItem {
    if (element.kind === 'action') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description;
      item.iconPath = new vscode.ThemeIcon(element.icon);
      item.command = element.command;
      return item;
    }

    if (element.kind === 'metric') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description;
      item.iconPath = new vscode.ThemeIcon(element.icon);
      if (element.tooltip) {
        item.tooltip = element.tooltip;
      }
      return item;
    }

    if (element.kind === 'recentGroup') {
      const item = new vscode.TreeItem(
        '最近阅读进度（前 5 本）',
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon('history');
      return item;
    }

    const { book, progress } = element;
    const p = progress.book;
    const pct = p?.progress ?? 0;
    const durSec = p?.readingTime ?? p?.recordReadingTime ?? 0;
    const item = new vscode.TreeItem(book.title, vscode.TreeItemCollapsibleState.None);
    item.description = `${pct}% · ${formatDuration(durSec)}`;
    item.tooltip = new vscode.MarkdownString(
      `**${book.title}**\n\n` +
        `- 作者：${book.author || '未知'}\n` +
        `- 阅读进度：${pct}%\n` +
        `- 累计时长：${formatDuration(durSec)}\n` +
        `- 最近阅读：${formatDate(p?.updateTime || book.readUpdateTime)}`,
    );
    item.iconPath = new vscode.ThemeIcon(pct === 100 ? 'pass-filled' : 'clock');
    item.contextValue = 'wxdsBook';
    item.command = {
      command: 'wxds.openReader',
      title: '继续阅读',
      arguments: [{ kind: 'book', book }],
    };
    return item;
  }

  async getChildren(element?: StatsNode): Promise<StatsNode[]> {
    if (!element) {
      try {
        if (!this.monthly || !this.annually || !this.overall) {
          const [m, a, o] = await Promise.all([
            this.api.getReadData('monthly'),
            this.api.getReadData('annually'),
            this.api.getReadData('overall'),
          ]);
          this.monthly = m;
          this.annually = a;
          this.overall = o;
        }
      } catch (err) {
        return [
          {
            kind: 'action',
            label: '无法加载阅读统计（点击配置 API Key）',
            description: err instanceof Error ? err.message : String(err),
            icon: 'key',
            command: { command: 'wxds.setApiKey', title: '配置 API Key' },
          },
        ];
      }

      return [
        {
          kind: 'action',
          label: '打开完整统计与偏好看板',
          description: '周/月/年/总计可视化',
          icon: 'graph',
          command: { command: 'wxds.openStatsDashboard', title: '打开统计看板' },
        },
        {
          kind: 'metric',
          label: '本月阅读',
          description: `${formatDuration(this.monthly.totalReadTime)} · ${this.monthly.readDays ?? 0}天`,
          icon: 'calendar',
          tooltip: `自然日均：${formatDuration(this.monthly.dayAverageReadTime)}`,
        },
        {
          kind: 'metric',
          label: '本年阅读',
          description: `${formatDuration(this.annually.totalReadTime)} · ${this.annually.readDays ?? 0}天`,
          icon: 'flame',
        },
        {
          kind: 'metric',
          label: '累计总计',
          description: `${formatDuration(this.overall.totalReadTime)} · ${this.overall.readDays ?? 0}天`,
          icon: 'star-full',
          tooltip: this.overall.preferCategoryWord || undefined,
        },
        {
          kind: 'metric',
          label: '阅读偏好',
          description: this.overall.preferCategoryWord || '暂无足够数据',
          icon: 'heart',
        },
        { kind: 'recentGroup' },
      ];
    }

    if (element.kind === 'recentGroup') {
      try {
        if (!this.recentProgress) {
          const shelf = await this.api.syncShelf();
          const top5 = [...(shelf.books ?? [])]
            .sort((a, b) => (b.readUpdateTime ?? 0) - (a.readUpdateTime ?? 0))
            .slice(0, 5);
          const progresses = await Promise.all(top5.map((b) => this.api.getProgress(b.bookId)));
          this.recentProgress = top5.map((book, idx) => ({
            book,
            progress: progresses[idx],
          }));
        }
        return this.recentProgress.map(({ book, progress }) => ({
          kind: 'recentBook',
          book,
          progress,
        }));
      } catch {
        return [];
      }
    }

    return [];
  }
}
