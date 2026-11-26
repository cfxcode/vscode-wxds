import type { NotebookItem, ShelfStats, ShelfSyncResponse } from '../types/weread';

export function formatDate(unixSeconds?: number | null): string {
  if (!unixSeconds || unixSeconds <= 0) {
    return '-';
  }
  const date = new Date(unixSeconds * 1000 + 8 * 3600 * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDuration(seconds?: number | null): string {
  if (seconds === undefined || seconds === null || seconds < 0) {
    return '-';
  }
  const s = Math.floor(seconds);
  if (s === 0) {
    return '0分钟';
  }
  if (s < 60) {
    return '不足1分钟';
  }
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (hours > 0) {
    return `${hours}小时${minutes}分钟`;
  }
  return `${minutes}分钟`;
}

export function formatStar(star?: number | null): string {
  if (!star || star <= 0) {
    return '无评分';
  }
  const count = Math.max(1, Math.min(5, Math.round(star / 20)));
  return '⭐'.repeat(count);
}

export function formatRating(rating?: number | null): string {
  if (!rating || rating <= 0) {
    return '';
  }
  if (rating > 100) {
    return `${(rating / 10).toFixed(1)}%`;
  }
  return `${rating}%`;
}

export function computeShelfStats(shelf: ShelfSyncResponse): ShelfStats {
  const books = shelf.books ?? [];
  const albums = shelf.albums ?? [];
  const hasMp = Boolean(shelf.mp && Object.keys(shelf.mp).length > 0);
  const mpCount = hasMp ? 1 : 0;

  let privateBooks = 0;
  let publicBooks = 0;
  let finishedCount = 0;
  for (const b of books) {
    if (b.secret === 1) {
      privateBooks += 1;
    } else {
      publicBooks += 1;
    }
    if (b.finishReading === 1) {
      finishedCount += 1;
    }
  }

  let privateAlbums = 0;
  let publicAlbums = 0;
  for (const a of albums) {
    if (a.albumInfoExtra?.secret === 1) {
      privateAlbums += 1;
    } else {
      publicAlbums += 1;
    }
  }

  return {
    totalVisible: books.length + albums.length + mpCount,
    bookCount: books.length,
    albumCount: albums.length,
    mpCount,
    publicCount: publicBooks + publicAlbums,
    privateCount: privateBooks + privateAlbums + mpCount,
    finishedCount,
  };
}

export function computeNotebookTotal(item: NotebookItem): number {
  return (item.reviewCount ?? 0) + (item.noteCount ?? 0) + (item.bookmarkCount ?? 0);
}

export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || 'untitled-book';
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
