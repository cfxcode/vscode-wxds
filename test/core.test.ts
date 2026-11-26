import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeNotebookTotal,
  computeShelfStats,
  formatDate,
  formatDuration,
  formatStar,
  sanitizeFilename,
} from '../src/utils/format';
import {
  injectCustomStyle,
  rewriteResponseHeaders,
  rewriteSetCookie,
  toLocalProxyUrl,
} from '../src/proxy/wereadProxy';
import { generateBookNotesMarkdown } from '../src/services/markdownExporter';

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

test('proxy header & cookie rewrites strip frame blockers and fix cookies', () => {
  const cookie = rewriteSetCookie('wr_skey=abc; Path=/; Domain=.weread.qq.com; Secure; SameSite=None');
  assert.ok(!/Domain=/i.test(cookie));
  assert.ok(!/Secure/i.test(cookie));
  assert.ok(/SameSite=Lax/i.test(cookie));

  const headers = rewriteResponseHeaders(
    {
      'x-frame-options': 'SAMEORIGIN',
      'content-security-policy': "frame-ancestors 'self'",
      location: 'https://weread.qq.com/web/reader/123',
      'set-cookie': ['wr_vid=1; Domain=.weread.qq.com; Secure'],
      'content-type': 'text/html; charset=utf-8',
    },
    'http://127.0.0.1:45678',
  );

  assert.equal(headers['x-frame-options'], undefined);
  assert.equal(headers['content-security-policy'], undefined);
  assert.equal(headers.location, 'http://127.0.0.1:45678/web/reader/123');
  assert.deepEqual(headers['set-cookie'], ['wr_vid=1']);
});

test('proxy URL mapping and custom style injection work cleanly', () => {
  assert.equal(
    toLocalProxyUrl('https://weread.qq.com/web/reader/abc?foo=1', 'http://127.0.0.1:9000'),
    'http://127.0.0.1:9000/web/reader/abc?foo=1',
  );
  const injected = injectCustomStyle('<html><head><title>x</title></head><body></body></html>', {
    opacity: 0.6,
    hideScrollbar: true,
  });
  assert.ok(injected.includes('opacity: 0.6 !important;'));
  assert.ok(injected.includes('::-webkit-scrollbar'));
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
