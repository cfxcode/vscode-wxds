import type {
  BestBookmarksResponse,
  BookInfoResponse,
  BookmarkListResponse,
  BookProgressResponse,
  ChapterInfoResponse,
  MyReviewEntry,
  MyReviewsResponse,
  NotebookItem,
  NotebooksResponse,
  PublicReviewsResponse,
  ReadDataMode,
  ReadDataResponse,
  RecommendResponse,
  SearchResponse,
  ShelfSyncResponse,
  SimilarResponse,
  WeReadBaseResponse,
} from '../types/weread';

export const DEFAULT_GATEWAY = 'https://i.weread.qq.com/api/agent/gateway';
export const SKILL_VERSION = '1.0.6';

export class WeReadApiError extends Error {
  constructor(
    message: string,
    public readonly errcode?: number,
  ) {
    super(message);
    this.name = 'WeReadApiError';
  }
}

export interface ApiKeyProvider {
  getApiKey(): Promise<string | undefined>;
  getGatewayUrl(): string;
}

export class WeReadApiClient {
  constructor(private readonly provider: ApiKeyProvider) {}

  private async request<T extends WeReadBaseResponse>(
    apiName: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const apiKey = await this.provider.getApiKey();
    if (!apiKey) {
      throw new WeReadApiError(
        '尚未配置 WEREAD_API_KEY。请执行命令「微信读书：配置 API Key」或在环境中设置 WEREAD_API_KEY。',
      );
    }

    const gateway = this.provider.getGatewayUrl() || DEFAULT_GATEWAY;
    const body = {
      api_name: apiName,
      ...params,
      skill_version: SKILL_VERSION,
    };

    const res = await fetch(gateway, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': `vscode-wxds/${SKILL_VERSION}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new WeReadApiError(`微信读书接口请求失败（HTTP ${res.status}）`, res.status);
    }

    const data = (await res.json()) as T;
    if (data.errcode && data.errcode !== 0) {
      throw new WeReadApiError(
        data.errmsg || `微信读书接口返回错误（errcode=${data.errcode}）`,
        data.errcode,
      );
    }

    return data;
  }

  syncShelf(): Promise<ShelfSyncResponse> {
    return this.request<ShelfSyncResponse>('/shelf/sync');
  }

  getBookInfo(bookId: string): Promise<BookInfoResponse> {
    return this.request<BookInfoResponse>('/book/info', { bookId });
  }

  getChapterInfo(bookId: string): Promise<ChapterInfoResponse> {
    return this.request<ChapterInfoResponse>('/book/chapterinfo', { bookId });
  }

  getProgress(bookId: string): Promise<BookProgressResponse> {
    return this.request<BookProgressResponse>('/book/getprogress', { bookId });
  }

  getReadData(mode: ReadDataMode = 'monthly', baseTime?: number): Promise<ReadDataResponse> {
    const params: Record<string, unknown> = { mode };
    if (baseTime !== undefined) {
      params.baseTime = baseTime;
    }
    return this.request<ReadDataResponse>('/readdata/detail', params);
  }

  async getAllNotebooks(): Promise<{
    totalBookCount: number;
    totalNoteCount: number;
    books: NotebookItem[];
  }> {
    const allBooks: NotebookItem[] = [];
    let lastSort: number | undefined;
    let totalBookCount = 0;
    let totalNoteCount = 0;

    for (let page = 0; page < 50; page += 1) {
      const params: Record<string, unknown> = { count: 100 };
      if (lastSort !== undefined) {
        params.lastSort = lastSort;
      }
      const resp = await this.request<NotebooksResponse>('/user/notebooks', params);
      if (page === 0) {
        totalBookCount = resp.totalBookCount ?? 0;
        totalNoteCount = resp.totalNoteCount ?? 0;
      }
      const chunk = resp.books ?? [];
      allBooks.push(...chunk);

      if (!resp.hasMore || chunk.length === 0) {
        break;
      }
      const nextSort = chunk[chunk.length - 1]?.sort;
      if (nextSort === undefined || nextSort === lastSort) {
        break;
      }
      lastSort = nextSort;
    }

    return {
      totalBookCount: totalBookCount || allBooks.length,
      totalNoteCount,
      books: allBooks,
    };
  }

  getBookmarks(bookId: string): Promise<BookmarkListResponse> {
    return this.request<BookmarkListResponse>('/book/bookmarklist', { bookId });
  }

  async getMyReviews(bookId: string): Promise<MyReviewEntry[]> {
    const all: MyReviewEntry[] = [];
    let synckey = 0;

    for (let page = 0; page < 30; page += 1) {
      const resp = await this.request<MyReviewsResponse>('/review/list/mine', {
        bookid: bookId,
        count: 20,
        synckey,
      });
      const chunk = resp.reviews ?? [];
      all.push(...chunk);
      if (!resp.hasMore || chunk.length === 0 || !resp.synckey || resp.synckey === synckey) {
        break;
      }
      synckey = resp.synckey;
    }

    return all;
  }

  getBestBookmarks(bookId: string, chapterUid = 0): Promise<BestBookmarksResponse> {
    return this.request<BestBookmarksResponse>('/book/bestbookmarks', {
      bookId,
      chapterUid,
    });
  }

  getPublicReviews(
    bookId: string,
    reviewListType = 0,
    count = 20,
    maxIdx = 0,
    synckey = 0,
  ): Promise<PublicReviewsResponse> {
    return this.request<PublicReviewsResponse>('/review/list', {
      bookId,
      reviewListType,
      count,
      maxIdx,
      synckey,
    });
  }

  searchStore(
    keyword: string,
    scope: number,
    context: string,
    maxIdx = 0,
  ): Promise<SearchResponse> {
    return this.request<SearchResponse>('/store/search', {
      keyword,
      scope,
      context,
      maxIdx,
    });
  }

  getRecommendations(context: string, count = 12, maxIdx = 0): Promise<RecommendResponse> {
    return this.request<RecommendResponse>('/book/recommend', {
      context,
      count,
      maxIdx,
    });
  }

  getSimilarBooks(
    bookId: string,
    context: string,
    count = 12,
    maxIdx = 0,
    sessionId?: string,
  ): Promise<SimilarResponse> {
    const params: Record<string, unknown> = {
      bookId,
      context,
      count,
      maxIdx,
    };
    if (sessionId) {
      params.sessionId = sessionId;
    }
    return this.request<SimilarResponse>('/book/similar', params);
  }
}
