import { AbstractPaginator } from './AbstractPaginator.js'
import { LengthAwarePaginator } from './LengthAwarePaginator.js'
import type { PaginationOptions, SimplePaginatedResponse } from './PaginationMeta.js'
import { buildPaginatorUrl } from './urlHelpers.js'

/**
 * Simple (non–length-aware) paginator: one query fetching `perPage + 1` rows.
 */
export class Paginator<T> extends AbstractPaginator<T> {
  private readonly currentPageNumber: number
  private readonly morePages: boolean

  /**
   * @param items - Up to `perPage` items (extra probe row must already be removed by the caller).
   * @param perPage - Requested page size.
   * @param currentPage - 1-based page number.
   * @param hasMore - Whether another full page may exist after this one.
   * @param options - Path, query, fragment.
   */
  public constructor(
    items: T[],
    perPage: number,
    currentPage: number,
    hasMore: boolean,
    options?: PaginationOptions,
  ) {
    const path = LengthAwarePaginator.resolvePath(options?.path)
    super(items, perPage, path, options?.query ?? {}, options?.fragment ?? null)
    this.currentPageNumber = currentPage
    this.morePages = hasMore
  }

  public currentPage(): number {
    return this.currentPageNumber
  }

  public hasMorePages(): boolean {
    return this.morePages
  }

  public previousPageUrl(): string | null {
    if (this.currentPageNumber <= 1) return null
    return buildPaginatorUrl(
      this.currentPath,
      this.queryParams,
      'page',
      String(this.currentPageNumber - 1),
      this.fragmentString,
    )
  }

  public nextPageUrl(): string | null {
    if (!this.hasMorePages()) return null
    return buildPaginatorUrl(
      this.currentPath,
      this.queryParams,
      'page',
      String(this.currentPageNumber + 1),
      this.fragmentString,
    )
  }

  public toJSON(): SimplePaginatedResponse<T> {
    return {
      data: this.pageItems,
      meta: {
        currentPage: this.currentPageNumber,
        perPage: this.perPageCount,
        hasMorePages: this.morePages,
        from:
          this.pageItems.length === 0 ? null : (this.currentPageNumber - 1) * this.perPageCount + 1,
        to:
          this.pageItems.length === 0
            ? null
            : (this.currentPageNumber - 1) * this.perPageCount + this.pageItems.length,
        path: this.currentPath,
      },
      links: {
        prev: this.previousPageUrl(),
        next: this.nextPageUrl(),
      },
    }
  }
}
