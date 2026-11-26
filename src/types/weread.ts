export interface WeReadBaseResponse {
  errcode?: number;
  errmsg?: string;
  upgrade_info?: unknown;
}

export interface ShelfBook {
  bookId: string;
  title: string;
  author?: string;
  cover?: string;
  category?: string;
  readUpdateTime?: number;
  finishReading?: number;
  updateTime?: number;
  isTop?: boolean | number;
  secret?: number;
  readerLink?: string;
  deepLink?: string;
}

export interface ShelfAlbum {
  albumInfo?: {
    albumId?: string;
    name?: string;
    authorName?: string;
    cover?: string;
    trackCount?: number;
    finishStatus?: string;
    finish?: number;
    payType?: number;
    intro?: string;
    updateTime?: number;
  };
  albumInfoExtra?: {
    secret?: number;
    lecturePaid?: number;
    lectureReadUpdateTime?: number;
    isTop?: boolean | number;
  };
}

export interface ShelfArchive {
  name: string;
  bookIds: string[];
}

export interface ShelfSyncResponse extends WeReadBaseResponse {
  books?: ShelfBook[];
  albums?: ShelfAlbum[];
  mp?: Record<string, unknown> | null;
  archive?: ShelfArchive[];
  bookCount?: number;
}

export interface ShelfStats {
  totalVisible: number;
  bookCount: number;
  albumCount: number;
  mpCount: number;
  publicCount: number;
  privateCount: number;
  finishedCount: number;
}

export interface BookInfoResponse extends WeReadBaseResponse {
  bookId: string;
  title?: string;
  author?: string;
  translator?: string;
  cover?: string;
  intro?: string;
  category?: string;
  publisher?: string;
  publishTime?: string;
  isbn?: string;
  wordCount?: number;
  newRating?: number;
  newRatingCount?: number;
  newRatingDetail?: {
    title?: string;
    [key: string]: unknown;
  };
  readerLink?: string;
  deepLink?: string;
}

export interface BookChapter {
  chapterUid: number;
  chapterIdx: number;
  title: string;
  wordCount?: number;
  level?: number;
  updateTime?: number;
  price?: number;
  paid?: number;
  isMPChapter?: number;
}

export interface ChapterInfoResponse extends WeReadBaseResponse {
  bookId: string;
  chapters?: BookChapter[];
}

export interface BookProgressResponse extends WeReadBaseResponse {
  bookId: string;
  book?: {
    chapterUid?: number;
    chapterOffset?: number;
    progress?: number;
    updateTime?: number;
    readingTime?: number;
    recordReadingTime?: number;
    finishTime?: number;
    isStartReading?: number;
    summary?: string;
  };
  timestamp?: number;
}

export type ReadDataMode = 'weekly' | 'monthly' | 'annually' | 'overall';

export interface ReadLongestItem {
  book?: {
    bookId?: string;
    title?: string;
    author?: string;
    cover?: string;
    readerLink?: string;
    deepLink?: string;
  };
  albumInfo?: {
    albumId?: string;
    name?: string;
    authorName?: string;
  };
  readTime?: number;
  recordReadingTime?: number;
  tags?: string[];
}

export interface ReadDataResponse extends WeReadBaseResponse {
  baseTime?: number;
  readTimes?: Record<string, number>;
  dailyReadTimes?: Record<string, number>;
  readDays?: number;
  totalReadTime?: number;
  dayAverageReadTime?: number;
  compare?: number;
  readLongest?: ReadLongestItem[];
  readStat?: Array<{ stat?: string; counts?: string; scheme?: string }>;
  preferCategory?: Array<{
    categoryId?: string;
    categoryTitle?: string;
    readingTime?: number;
    readingCount?: number;
    val?: number;
  }>;
  preferCategoryWord?: string;
  preferTime?: number[];
  preferTimeWord?: string;
  preferAuthor?: Array<{
    authorId?: string;
    name?: string;
    count?: number;
    readTime?: string;
  }>;
  preferPublisher?: Array<{ name?: string; count?: number }>;
  readRate?: number;
  wrReadTime?: number;
  wrListenTime?: number;
  rank?: { text?: string; scheme?: string };
  registTime?: number;
}

export interface NotebookItem {
  bookId: string;
  book?: {
    bookId?: string;
    title?: string;
    author?: string;
    cover?: string;
    readerLink?: string;
    deepLink?: string;
  };
  reviewCount?: number;
  noteCount?: number;
  bookmarkCount?: number;
  readingProgress?: number;
  markedStatus?: number;
  sort?: number;
}

export interface NotebooksResponse extends WeReadBaseResponse {
  totalBookCount?: number;
  totalNoteCount?: number;
  hasMore?: number;
  books?: NotebookItem[];
}

export interface BookmarkItem {
  bookmarkId: string;
  bookId: string;
  chapterUid: number;
  markText: string;
  createTime?: number;
  type?: number;
  range?: string;
  colorStyle?: number;
}

export interface BookmarkListResponse extends WeReadBaseResponse {
  updated?: BookmarkItem[];
  chapters?: Array<{
    chapterUid: number;
    chapterIdx?: number;
    title: string;
  }>;
  book?: {
    bookId?: string;
    title?: string;
    author?: string;
    readerLink?: string;
    deepLink?: string;
  };
}

export interface MyReviewEntry {
  reviewId?: string;
  review?: {
    reviewId?: string;
    content?: string;
    abstract?: string;
    range?: string;
    chapterUid?: number;
    chapterIdx?: number;
    chapterName?: string;
    createTime?: number;
    star?: number;
    isFinish?: number;
  };
}

export interface MyReviewsResponse extends WeReadBaseResponse {
  reviews?: MyReviewEntry[];
  totalCount?: number;
  hasMore?: number;
  synckey?: number;
}

export interface BestBookmarkItem {
  bookId: string;
  bookmarkId: string;
  chapterUid: number;
  range?: string;
  markText: string;
  totalCount?: number;
}

export interface BestBookmarksResponse extends WeReadBaseResponse {
  totalCount?: number;
  items?: BestBookmarkItem[];
  chapters?: Array<{
    chapterUid: number;
    chapterIdx?: number;
    title: string;
  }>;
}

export interface PublicReviewEntry {
  idx?: number;
  review?: {
    reviewId?: string;
    review?: {
      content?: string;
      htmlContent?: string;
      star?: number;
      isFinish?: number;
      createTime?: number;
      chapterName?: string;
      author?: {
        userVid?: number;
        name?: string;
        avatar?: string;
      };
    };
  };
}

export interface PublicReviewsResponse extends WeReadBaseResponse {
  synckey?: number;
  reviewsCnt?: number;
  recentTotalCnt?: number;
  reviewsHasMore?: number;
  friendCommentCount?: number;
  deepVRecommendInfo?: {
    title?: string;
    subtitle?: string;
  };
  reviews?: PublicReviewEntry[];
}

export interface SearchBookWrapper {
  searchIdx?: number;
  readingCount?: number;
  newRating?: number;
  newRatingCount?: number;
  newRatingDetail?: { title?: string };
  bookInfo?: {
    bookId?: string;
    title?: string;
    author?: string;
    cover?: string;
    intro?: string;
    publisher?: string;
    category?: string;
    price?: number;
    soldout?: number;
    readerLink?: string;
    deepLink?: string;
  };
}

export interface SearchResponse extends WeReadBaseResponse {
  sid?: string;
  hasMore?: number;
  results?: Array<{
    title?: string;
    scope?: number;
    scopeCount?: number;
    currentCount?: number;
    books?: SearchBookWrapper[];
  }>;
}

export interface RecommendBook {
  bookId: string;
  title?: string;
  author?: string;
  cover?: string;
  intro?: string;
  category?: string;
  reason?: string;
  readingCount?: number;
  searchIdx?: number;
  newRating?: number;
  newRatingCount?: number;
  newRatingDetail?: { title?: string };
  readerLink?: string;
  deepLink?: string;
}

export interface RecommendResponse extends WeReadBaseResponse {
  books?: RecommendBook[];
}

export interface SimilarResponse extends WeReadBaseResponse {
  booksimilar?: {
    sessionId?: string;
    books?: Array<{
      idx?: number;
      book?: {
        bookInfo?: RecommendBook;
      };
    }>;
  };
}
