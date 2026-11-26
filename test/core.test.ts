import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeNotebookTotal,
  computeShelfStats,
  formatDate,
  formatDuration,
  formatRating,
  formatStar,
  sanitizeFilename,
} from '../src/utils/format';
import { generateBookNotesMarkdown } from '../src/services/markdownExporter';
import { WeReadApiClient, WeReadApiError } from '../src/api/wereadApi';

test('formatDate formats Unix timestamps in UTC+8 YYYY-MM-DD', () => {
  assert.equal(formatDate(1795675736), '2026-11-26');
  assert.equal(formatDate(0), '-');
  assert.equal(formatDate(undefined), '-');
});

test('formatDuration converts seconds to Chinese duration strings', () => {
  assert.equal(formatDuration(0), '0分钟');
  assert.equal(formatDuration(45), '不足1分钟');
  assert.equal(formatDuration(343), '5分钟');
  assert.equal(formatDuration(7438), '2小时3分钟');
  assert.equal(formatDuration(undefined), '-');
});

test('formatStar maps 20-100 scale to 1-5 stars', () => {
  assert.equal(formatStar(100), '⭐⭐⭐⭐⭐');
  assert.equal(formatStar(60), '⭐⭐⭐');
  assert.equal(formatStar(20), '⭐');
  assert.equal(formatStar(0), '无评分');
});

test('formatRating handles both 0-100 and 0-1000 WeRead scales', () => {
  assert.equal(formatRating(826), '82.6%');
  assert.equal(formatRating(950), '95.0%');
  assert.equal(formatRating(92), '92%');
  assert.equal(formatRating(0), '');
  assert.equal(formatRating(undefined), '');
});

test('computeShelfStats counts books + albums + mp and public/private accurately', () => {
  const stats = computeShelfStats({
    books: [
      { bookId: '1', title: 'A', secret: 0, finishReading: 1 },
      { bookId: '2', title: 'B', secret: 1, finishReading: 0 },
    ],
    albums: [
      { albumInfo: { albumId: 'a1', name: 'Album' }, albumInfoExtra: { secret: 0 } },
    ],
    mp: { show: 1 },
  });

  assert.equal(stats.totalVisible, 4);
  assert.equal(stats.bookCount, 2);
  assert.equal(stats.albumCount, 1);
  assert.equal(stats.mpCount, 1);
  assert.equal(stats.publicCount, 2);
  assert.equal(stats.privateCount, 2);
  assert.equal(stats.finishedCount, 1);
});

test('computeNotebookTotal sums reviewCount + noteCount + bookmarkCount', () => {
  assert.equal(
    computeNotebookTotal({ bookId: '1', reviewCount: 2, noteCount: 5, bookmarkCount: 1 }),
    8,
  );
});

test('sanitizeFilename strips unsafe filesystem characters', () => {
  assert.equal(sanitizeFilename('三体: 死神永生/典藏版?'), '三体_ 死神永生_典藏版_');
});

test('WeReadApiClient rejects cleanly when API key is missing', async () => {
  const client = new WeReadApiClient({
    async getApiKey() {
      return undefined;
    },
    getGatewayUrl() {
      return 'https://i.weread.qq.com/api/agent/gateway';
    },
  });

  await assert.rejects(
    () => client.syncShelf(),
    (err: unknown) => err instanceof WeReadApiError && err.message.includes('WEREAD_API_KEY'),
  );
});

test('generateBookNotesMarkdown formats YAML frontmatter, chapters, highlights and thoughts', () => {
  const md = generateBookNotesMarkdown({
    bookId: '3300219440',
    title: '中国通史',
    author: '吕思勉',
    readerLink: 'https://weread.qq.com/web/reader/test',
    exportDate: '2026-11-26',
    notebook: {
      bookId: '3300219440',
      noteCount: 1,
      reviewCount: 1,
      bookmarkCount: 2,
      readingProgress: 35,
    },
    bookmarks: {
      chapters: [{ chapterUid: 1, chapterIdx: 1, title: '绪论' }],
      updated: [
        {
          bookmarkId: 'bm1',
          bookId: '3300219440',
          chapterUid: 1,
          markText: '世界上哪有真正相同的事情？',
          createTime: 1786460587,
          range: '10-22',
        },
      ],
    },
    myReviews: [
      {
        review: {
          chapterUid: 1,
          range: '10-22',
          abstract: '世界上哪有真正相同的事情？',
          content: '历史不会简单重复，但会押韵。',
          createTime: 1786460600,
        },
      },
    ],
  });

  assert.ok(md.includes('title: "中国通史"'));
  assert.ok(md.includes('totalNotes: 4'));
  assert.ok(md.includes('## 绪论'));
  assert.ok(md.includes('> 世界上哪有真正相同的事情？'));
  assert.ok(md.includes('历史不会简单重复，但会押韵。'));
  assert.ok(md.includes('共有 2 个书签'));
});
