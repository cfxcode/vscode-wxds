import type { BookmarkListResponse, MyReviewEntry, NotebookItem } from '../types/weread';
import { computeNotebookTotal, formatDate, formatStar } from '../utils/format';

export interface BookNotesExportInput {
  bookId: string;
  title: string;
  author: string;
  readerLink?: string;
  notebook?: NotebookItem;
  bookmarks: BookmarkListResponse;
  myReviews: MyReviewEntry[];
  exportDate?: string;
}

export function generateBookNotesMarkdown(input: BookNotesExportInput): string {
  const { bookId, title, author, readerLink, notebook, bookmarks, myReviews } = input;
  const exportDate = input.exportDate || formatDate(Math.floor(Date.now() / 1000));

  const chapterMap = new Map<number, { title: string; idx: number }>();
  for (const ch of bookmarks.chapters ?? []) {
    chapterMap.set(ch.chapterUid, {
      title: ch.title,
      idx: ch.chapterIdx ?? ch.chapterUid,
    });
  }

  const highlights = bookmarks.updated ?? [];
  const reviewItems = myReviews
    .map((entry) => entry.review)
    .filter((r): r is NonNullable<MyReviewEntry['review']> => Boolean(r));

  const bookmarkCount = notebook?.bookmarkCount ?? 0;
  const totalCount = notebook
    ? computeNotebookTotal(notebook)
    : highlights.length + reviewItems.length + bookmarkCount;

  const lines: string[] = [
    '---',
    `title: "${title.replace(/"/g, '\\"')}"`,
    `author: "${(author || '未知').replace(/"/g, '\\"')}"`,
    `bookId: "${bookId}"`,
    `exportedAt: "${exportDate}"`,
    `totalNotes: ${totalCount}`,
    `highlights: ${highlights.length}`,
    `thoughts: ${reviewItems.length}`,
    `bookmarksCount: ${bookmarkCount}`,
  ];

  if (notebook?.readingProgress !== undefined) {
    lines.push(`readingProgress: "${notebook.readingProgress}%"`);
  }
  if (readerLink) {
    lines.push(`readerLink: "${readerLink}"`);
  }
  lines.push('---', '', `# ${title}`, '');

  const metaParts = [`**作者**：${author || '未知'}`];
  if (notebook?.readingProgress !== undefined) {
    metaParts.push(`**阅读进度**：${notebook.readingProgress}%`);
  }
  metaParts.push(
    `**笔记统计**：共 ${totalCount} 条（划线 ${highlights.length} · 想法/点评 ${reviewItems.length} · 书签 ${bookmarkCount}）`,
  );
  if (readerLink) {
    metaParts.push(`[打开阅读](${readerLink})`);
  }
  lines.push(metaParts.join(' ｜ '), '');

  // Book-level reviews (without chapterUid / abstract)
  const bookLevelReviews = reviewItems.filter((r) => !r.abstract && !r.chapterUid);
  if (bookLevelReviews.length > 0) {
    lines.push('## 整本书评', '');
    for (const r of bookLevelReviews) {
      const starText = r.star && r.star > 0 ? ` · ${formatStar(r.star * 20)}` : '';
      lines.push(`- **${formatDate(r.createTime)}**${starText}`);
      if (r.content) {
        lines.push('', `  ${r.content.replace(/\n/g, '\n  ')}`, '');
      }
    }
  }

  // Group highlights & chapter reviews by chapterUid
  type ChapterBucket = {
    chapterUid: number;
    chapterIdx: number;
    chapterTitle: string;
    highlights: typeof highlights;
    thoughts: typeof reviewItems;
  };

  const buckets = new Map<number, ChapterBucket>();
  const ensureBucket = (chapterUid: number, fallbackTitle?: string): ChapterBucket => {
    let bucket = buckets.get(chapterUid);
    if (!bucket) {
      const meta = chapterMap.get(chapterUid);
      bucket = {
        chapterUid,
        chapterIdx: meta?.idx ?? chapterUid,
        chapterTitle: meta?.title || fallbackTitle || `章节 ${chapterUid}`,
        highlights: [],
        thoughts: [],
      };
      buckets.set(chapterUid, bucket);
    }
    return bucket;
  };

  for (const h of highlights) {
    ensureBucket(h.chapterUid).highlights.push(h);
  }
  for (const r of reviewItems) {
    if (r.abstract || r.chapterUid) {
      const uid = r.chapterUid ?? 0;
      ensureBucket(uid, r.chapterName).thoughts.push(r);
    }
  }

  const sortedBuckets = Array.from(buckets.values()).sort((a, b) => a.chapterIdx - b.chapterIdx);

  if (sortedBuckets.length === 0 && bookLevelReviews.length === 0) {
    lines.push('_当前书籍暂无可导出的划线或想法内容。_', '');
  } else {
    for (const bucket of sortedBuckets) {
      lines.push(`## ${bucket.chapterTitle}`, '');

      const matchedThoughtIdx = new Set<number>();

      for (const h of bucket.highlights) {
        lines.push(`> ${h.markText.replace(/\n/g, '\n> ')}`, '');
        lines.push(`*划线时间：${formatDate(h.createTime)}*`, '');

        bucket.thoughts.forEach((t, idx) => {
          if (
            !matchedThoughtIdx.has(idx) &&
            ((t.range && h.range && t.range === h.range) ||
              (t.abstract && h.markText && t.abstract.trim() === h.markText.trim()))
          ) {
            matchedThoughtIdx.add(idx);
            if (t.content) {
              lines.push(`- **想法**（${formatDate(t.createTime)}）：${t.content}`, '');
            }
          }
        });
      }

      bucket.thoughts.forEach((t, idx) => {
        if (matchedThoughtIdx.has(idx)) {
          return;
        }
        if (t.abstract) {
          lines.push(`> ${t.abstract.replace(/\n/g, '\n> ')}`, '');
        }
        if (t.content) {
          lines.push(`- **想法/点评**（${formatDate(t.createTime)}）：${t.content}`, '');
        }
      });
    }
  }

  if (bookmarkCount > 0) {
    lines.push(
      '---',
      '',
      `> 注：本书共有 ${bookmarkCount} 个书签（当前微信读书官方接口仅提供书签数量统计，暂不支持导出书签内容）。`,
      '',
    );
  }

  return lines.join('\n');
}
