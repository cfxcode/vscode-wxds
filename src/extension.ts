import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DEFAULT_GATEWAY, WeReadApiClient } from './api/wereadApi';
import { generateBookNotesMarkdown } from './services/markdownExporter';
import type { NotebookItem } from './types/weread';
import { formatRating, sanitizeFilename } from './utils/format';
import { BookDetailPanel } from './views/bookDetailPanel';
import { DiscoverNode, DiscoverTreeProvider } from './views/discoverTreeProvider';
import { NoteDetailPanel } from './views/noteDetailPanel';
import { NotesNode, NotesTreeProvider } from './views/notesTreeProvider';
import { ShelfNode, ShelfTreeProvider } from './views/shelfTreeProvider';
import { StatsDashboardPanel } from './views/statsDashboardPanel';
import { StatsNode, StatsTreeProvider } from './views/statsTreeProvider';

const SECRET_API_KEY = 'wxds.wereadApiKey';

const SEARCH_SCOPES = [
  { label: '电子书', description: '只搜电子书（不含网文）', scope: 10 },
  { label: '全部综合搜索', description: '电子书 / 作者 / 书单等多分组', scope: 0 },
  { label: '网文小说', description: '只搜网络小说', scope: 16 },
  { label: '微信听书', description: '有声书 / 专辑 / 播客', scope: 14 },
  { label: '作者', description: '按作者名搜索', scope: 6 },
  { label: '书籍正文全文', description: '按书内正文片段搜索', scope: 12 },
  { label: '书单', description: '搜索用户书单', scope: 13 },
  { label: '公众号', description: '搜索公众号', scope: 2 },
  { label: '公众号文章', description: '搜索文章', scope: 4 },
];

type DirectBookTarget = {
  kind?: undefined;
  bookId: string;
  title?: string;
  author?: string;
  readerLink?: string;
};

function extractBookTarget(
  arg: unknown,
): { bookId: string; title: string; author: string; readerLink?: string; notebook?: NotebookItem } | undefined {
  if (!arg || typeof arg !== 'object') {
    return undefined;
  }
  const node = arg as ShelfNode | NotesNode | DiscoverNode | StatsNode | DirectBookTarget;
  if ('kind' in node && node.kind !== undefined) {
    if (node.kind === 'book' || node.kind === 'recentBook') {
      return {
        bookId: node.book.bookId,
        title: node.book.title,
        author: node.book.author || '',
        readerLink: node.book.readerLink || node.book.deepLink,
      };
    }
    if (node.kind === 'notebook') {
      return {
        bookId: node.notebook.bookId,
        title: node.notebook.book?.title || node.notebook.bookId,
        author: node.notebook.book?.author || '',
        readerLink: node.notebook.book?.readerLink || node.notebook.book?.deepLink,
        notebook: node.notebook,
      };
    }
    if (node.kind === 'recommend') {
      return {
        bookId: node.book.bookId,
        title: node.book.title || node.book.bookId,
        author: node.book.author || '',
        readerLink: node.book.readerLink || node.book.deepLink,
      };
    }
    if (node.kind === 'highlight' || node.kind === 'thought') {
      return {
        bookId: node.bookId,
        title: node.bookTitle,
        author: node.bookAuthor,
        readerLink: node.readerLink,
        notebook: node.notebook,
      };
    }
    return undefined;
  }
  if ('bookId' in node && typeof node.bookId === 'string') {
    return {
      bookId: node.bookId,
      title: node.title || node.bookId,
      author: node.author || '',
      readerLink: node.readerLink,
    };
  }
  return undefined;
}

async function resolveExportDirectory(): Promise<string | undefined> {
  const configuredDir = vscode.workspace
    .getConfiguration('wxds')
    .get<string>('exportDir', 'weread-notes');
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder) {
    const dirPath = path.isAbsolute(configuredDir)
      ? configuredDir
      : path.join(workspaceFolder.uri.fsPath, configuredDir);
    await fs.mkdir(dirPath, { recursive: true });
    return dirPath;
  }

  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: '选择笔记导出目录',
  });
  return picked?.[0]?.fsPath;
}

export function activate(context: vscode.ExtensionContext): void {
  const api = new WeReadApiClient({
    async getApiKey(): Promise<string | undefined> {
      const secret = await context.secrets.get(SECRET_API_KEY);
      if (secret && secret.trim()) {
        return secret.trim();
      }
      const envKey = process.env.WEREAD_API_KEY?.trim();
      return envKey || undefined;
    },
    getGatewayUrl(): string {
      return vscode.workspace.getConfiguration('wxds').get<string>('apiGateway', DEFAULT_GATEWAY);
    },
  });

  const shelfProvider = new ShelfTreeProvider(api);
  const notesProvider = new NotesTreeProvider(api);
  const statsProvider = new StatsTreeProvider(api);
  const discoverProvider = new DiscoverTreeProvider(api);

  const exportSingleBookNotes = async (
    bookId: string,
    title: string,
    author: string,
    readerLink?: string,
    notebook?: NotebookItem,
  ): Promise<void> => {
    const dir = await resolveExportDirectory();
    if (!dir) {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `正在导出《${title}》的笔记与划线...`,
        cancellable: false,
      },
      async () => {
        const [bookmarks, myReviews] = await Promise.all([
          api.getBookmarks(bookId),
          api.getMyReviews(bookId),
        ]);
        const md = generateBookNotesMarkdown({
          bookId,
          title,
          author,
          readerLink,
          notebook,
          bookmarks,
          myReviews,
        });
        const filePath = path.join(dir, `${sanitizeFilename(title)}.md`);
        await fs.writeFile(filePath, md, 'utf8');
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc, { preview: false });
        vscode.window.showInformationMessage(`已导出笔记到 ${filePath}`);
      },
    );
  };

  const findSimilarForBook = async (bookId: string, title: string): Promise<void> => {
    try {
      const resp = await api.getSimilarBooks(bookId, `查看与《${title}》相似的推荐好书`, 12, 0);
      const items = (resp.booksimilar?.books ?? [])
        .map((entry) => entry.book?.bookInfo)
        .filter((b): b is NonNullable<typeof b> => Boolean(b?.bookId));

      if (items.length === 0) {
        vscode.window.showInformationMessage(`暂无与《${title}》相似的推荐书籍。`);
        return;
      }

      const picked = await vscode.window.showQuickPick(
        items.map((b) => ({
          label: b.title || b.bookId,
          description: b.author || '',
          detail: b.intro?.slice(0, 100),
          book: b,
        })),
        { placeHolder: `与《${title}》相似的好书（选择查看详情）` },
      );

      if (picked) {
        await bookDetailPanel.open(picked.book.bookId, picked.book.title);
      }
    } catch (err) {
      vscode.window.showErrorMessage(
        `获取相似推荐失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const bookDetailPanel = new BookDetailPanel(context.extensionUri, api, {
    onReadExternal: (url) => {
      if (url) {
        void vscode.env.openExternal(vscode.Uri.parse(url));
      }
    },
    onExportNotes: (bookId, title, author, readerLink) => {
      void exportSingleBookNotes(bookId, title, author, readerLink);
    },
    onFindSimilar: (bookId, title) => {
      void findSimilarForBook(bookId, title);
    },
  });

  const statsDashboard = new StatsDashboardPanel(context.extensionUri, api, (bookId, title) => {
    void bookDetailPanel.open(bookId, title);
  });

  const noteDetailPanel = new NoteDetailPanel(context.extensionUri, api, {
    onOpenBookDetail: (bookId, title) => {
      void bookDetailPanel.open(bookId, title);
    },
    onExportNotes: (bookId, title, author, readerLink, notebook) => {
      void exportSingleBookNotes(bookId, title, author, readerLink, notebook);
    },
    onOpenExternal: (url) => {
      if (url) {
        void vscode.env.openExternal(vscode.Uri.parse(url));
      }
    },
  });

  // Register TreeViews
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('wxds.shelfView', shelfProvider),
    vscode.window.registerTreeDataProvider('wxds.notesView', notesProvider),
    vscode.window.registerTreeDataProvider('wxds.statsView', statsProvider),
    vscode.window.registerTreeDataProvider('wxds.discoverView', discoverProvider),
  );

  // Status bar item
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(book) 微信读书';
  statusBarItem.tooltip = '打开微信读书助手快捷菜单';
  statusBarItem.command = 'wxds.openQuickMenu';
  const syncStatusBarVisibility = () => {
    const show = vscode.workspace.getConfiguration('wxds').get<boolean>('showStatusBar', true);
    if (show) {
      statusBarItem.show();
    } else {
      statusBarItem.hide();
    }
  };
  syncStatusBarVisibility();
  context.subscriptions.push(statusBarItem);

  // Watch config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('wxds')) {
        syncStatusBarVisibility();
      }
    }),
  );

  const refreshAll = () => {
    shelfProvider.refresh();
    notesProvider.refresh();
    statsProvider.refresh();
    discoverProvider.refresh();
  };

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('wxds.openQuickMenu', async () => {
      const picked = await vscode.window.showQuickPick(
        [
          {
            label: '$(graph) 打开阅读统计与偏好看板',
            description: '本周 / 本月 / 本年 / 全部总计',
            cmd: 'wxds.openStatsDashboard',
          },
          {
            label: '$(search) 书城多维搜索',
            description: '电子书 / 网文 / 听书 / 全文 / 作者 / 书单',
            cmd: 'wxds.searchStore',
          },
          {
            label: '$(export) 一键导出全部笔记划线为 Markdown',
            description: '同步个人划线与想法到本地工作区',
            cmd: 'wxds.exportAllNotes',
          },
          {
            label: '$(link-external) 在官方浏览器打开微信读书',
            description: '安全直达 weread.qq.com',
            cmd: 'wxds.openExternalReader',
          },
          {
            label: '$(refresh) 刷新全部微信读书数据',
            description: '同步书架、笔记本、统计与推荐',
            cmd: 'wxds.refreshAll',
          },
          {
            label: '$(key) 配置 API Key',
            description: '加密保存到 VS Code SecretStorage',
            cmd: 'wxds.setApiKey',
          },
        ],
        { placeHolder: '微信读书助手 — 选择操作' },
      );
      if (picked) {
        await vscode.commands.executeCommand(picked.cmd);
      }
    }),

    vscode.commands.registerCommand('wxds.openExternalReader', async (arg?: unknown) => {
      const target = extractBookTarget(arg);
      const url = target?.readerLink || 'https://weread.qq.com/';
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }),

    vscode.commands.registerCommand('wxds.setApiKey', async () => {
      const value = await vscode.window.showInputBox({
        title: '配置微信读书 WEREAD_API_KEY',
        prompt:
          '输入 wrk-xxxxxxxx 格式的密钥（使用 VS Code SecretStorage 加密存储，不会写入明文配置）',
        password: true,
        ignoreFocusOut: true,
        placeHolder: 'wrk-xxxxxxxxxxxxxxxx',
      });
      if (value && value.trim()) {
        await context.secrets.store(SECRET_API_KEY, value.trim());
        vscode.window.showInformationMessage('已安全保存微信读书 API Key，正在刷新数据...');
        refreshAll();
      }
    }),

    vscode.commands.registerCommand('wxds.clearApiKey', async () => {
      await context.secrets.delete(SECRET_API_KEY);
      vscode.window.showInformationMessage(
        '已清除本地保存的 API Key（若系统环境变量中仍配置了 WEREAD_API_KEY 将自动回退使用）。',
      );
      refreshAll();
    }),

    vscode.commands.registerCommand('wxds.refreshAll', refreshAll),
    vscode.commands.registerCommand('wxds.refreshShelf', () => shelfProvider.refresh()),
    vscode.commands.registerCommand('wxds.refreshNotes', () => notesProvider.refresh()),
    vscode.commands.registerCommand('wxds.refreshStats', () => statsProvider.refresh()),
    vscode.commands.registerCommand('wxds.refreshDiscover', () => discoverProvider.refresh()),

    vscode.commands.registerCommand('wxds.openStatsDashboard', async () => {
      await statsDashboard.open('monthly');
    }),

    vscode.commands.registerCommand('wxds.viewNoteDetail', async (arg?: unknown) => {
      if (!arg || typeof arg !== 'object' || !('kind' in arg)) {
        return;
      }
      const node = arg as NotesNode;
      if (node.kind === 'highlight' || node.kind === 'thought') {
        await noteDetailPanel.open({
          kind: node.kind,
          bookId: node.bookId,
          bookTitle: node.bookTitle,
          bookAuthor: node.bookAuthor,
          readerLink: node.readerLink,
          notebook: node.notebook,
          chapterTitle: node.chapterTitle,
          text: node.text,
          abstract: node.kind === 'thought' ? node.abstract : undefined,
          createTime: node.createTime,
        });
      }
    }),

    vscode.commands.registerCommand('wxds.openBookDetail', async (arg?: unknown) => {
      const target = extractBookTarget(arg);
      if (!target) {
        const bookId = await vscode.window.showInputBox({
          prompt: '请输入书籍 ID（或在侧边栏选择一本书）',
        });
        if (!bookId?.trim()) {
          return;
        }
        await bookDetailPanel.open(bookId.trim());
        return;
      }
      await bookDetailPanel.open(target.bookId, target.title);
    }),

    vscode.commands.registerCommand('wxds.findSimilarBooks', async (arg?: unknown) => {
      const target = extractBookTarget(arg);
      if (!target) {
        vscode.window.showInformationMessage('请在书架、笔记或推荐列表中选择一本书。');
        return;
      }
      await findSimilarForBook(target.bookId, target.title);
    }),

    vscode.commands.registerCommand('wxds.searchStore', async () => {
      const pickedScope = await vscode.window.showQuickPick(SEARCH_SCOPES, {
        placeHolder: '选择搜索范围',
      });
      if (!pickedScope) {
        return;
      }
      const keyword = await vscode.window.showInputBox({
        prompt: `在「${pickedScope.label}」中搜索关键词`,
        placeHolder: '例如：三体 / 刘慈欣 / 心理学',
      });
      if (!keyword?.trim()) {
        return;
      }

      try {
        const resp = await api.searchStore(
          keyword.trim(),
          pickedScope.scope,
          `在 VS Code 中搜索${pickedScope.label}：${keyword.trim()}`,
          0,
        );

        const picks: Array<
          vscode.QuickPickItem & {
            bookId?: string;
            title?: string;
            readerLink?: string;
          }
        > = [];

        for (const group of resp.results ?? []) {
          const groupTitle = group.title || '搜索结果';
          for (const item of group.books ?? []) {
            const info = item.bookInfo;
            if (!info?.title) {
              continue;
            }
            const rating = formatRating(item.newRating);
            const reading = item.readingCount ? `${item.readingCount}人在读` : '';
            picks.push({
              label: info.title,
              description: [info.author || '', rating, reading, groupTitle]
                .filter(Boolean)
                .join(' · '),
              detail: info.intro?.slice(0, 120),
              bookId: info.bookId,
              title: info.title,
              readerLink: info.readerLink || info.deepLink,
            });
          }
        }

        if (picks.length === 0) {
          vscode.window.showInformationMessage(`没有找到与「${keyword.trim()}」相关的结果。`);
          return;
        }

        const selected = await vscode.window.showQuickPick(picks, {
          placeHolder: `为您找到 ${picks.length} 条结果（选择查看详情）`,
        });
        if (selected?.bookId) {
          await bookDetailPanel.open(selected.bookId, selected.title);
        }
      } catch (err) {
        vscode.window.showErrorMessage(
          `搜索失败：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    vscode.commands.registerCommand('wxds.exportBookNotes', async (arg?: unknown) => {
      const target = extractBookTarget(arg);
      if (!target) {
        vscode.window.showInformationMessage('请在书架或笔记本中选择一本书后再导出。');
        return;
      }
      try {
        await exportSingleBookNotes(
          target.bookId,
          target.title,
          target.author,
          target.readerLink,
          target.notebook,
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `导出失败：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    vscode.commands.registerCommand('wxds.exportAllNotes', async () => {
      const dir = await resolveExportDirectory();
      if (!dir) {
        return;
      }
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: '正在批量导出全部微信读书笔记与划线...',
            cancellable: true,
          },
          async (progress, token) => {
            const { books } = await api.getAllNotebooks();
            if (books.length === 0) {
              vscode.window.showInformationMessage('当前没有可导出的读书笔记。');
              return;
            }
            let exported = 0;
            for (const nb of books) {
              if (token.isCancellationRequested) {
                break;
              }
              const title = nb.book?.title || nb.bookId;
              const author = nb.book?.author || '';
              progress.report({
                message: `(${exported + 1}/${books.length}) ${title}`,
                increment: 100 / books.length,
              });
              const [bookmarks, myReviews] = await Promise.all([
                api.getBookmarks(nb.bookId),
                api.getMyReviews(nb.bookId),
              ]);
              const md = generateBookNotesMarkdown({
                bookId: nb.bookId,
                title,
                author,
                readerLink: nb.book?.readerLink || nb.book?.deepLink,
                notebook: nb,
                bookmarks,
                myReviews,
              });
              const filePath = path.join(dir, `${sanitizeFilename(title)}.md`);
              await fs.writeFile(filePath, md, 'utf8');
              exported += 1;
            }
            vscode.window.showInformationMessage(
              `已完成导出，共生成 ${exported} 份 Markdown 笔记（目录：${dir}）。`,
            );
          },
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `批量导出失败：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    statsDashboard,
    bookDetailPanel,
    noteDetailPanel,
  );
}

export function deactivate(): void {
  // All disposables are cleaned up via context.subscriptions
}
