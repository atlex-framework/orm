import { AbstractPaginator } from './AbstractPaginator.js'
import type { PaginatedResponse, PaginationOptions } from './PaginationMeta.js'
import { buildPaginatorUrl } from './urlHelpers.js'

/**
 * Offset paginator with total count and `lastPage` (two-query pagination).
 */
export class LengthAwarePaginator<T> extends AbstractPaginator<T> {
  private readonly totalCount: number
  private readonly currentPageNumber: number

  private static currentPageResolver: ((pageName?: string) => number) | undefined
  private static currentPathResolver: (() => string) | undefined

  /**
   * Merge an explicit path with the optional global path resolver.
   */
  public static resolvePath(path?: string): string {
    return path ?? LengthAwarePaginator.currentPathResolver?.() ?? ''
  }

  /** Default page size when none is passed to `paginate()`. */
  public static defaultPerPage = 15

  /**
   * @param items - Rows for the requested page (may be empty when page is out of range).
   * @param total - Total rows matching the query (all pages).
   * @param perPage - Page size.
   * @param currentPage - 1-based current page index stored in meta (may be invalid).
   * @param options - Path, query, fragment overrides.
   */
  public constructor(
    items: T[],
    total: number,
    perPage: number,
    currentPage: number,
    options?: PaginationOptions,
  ) {
    const path = LengthAwarePaginator.resolvePath(options?.path)
    super(items, perPage, path, options?.query ?? {}, options?.fragment ?? null)
    this.totalCount = total
    this.currentPageNumber = currentPage
  }

  /** @inheritdoc */
  public static resolveCurrentPage(resolver: (pageName?: string) => number): void {
    LengthAwarePaginator.currentPageResolver = resolver
  }

  /** @inheritdoc */
  public static resolveCurrentPath(resolver: () => string): void {
    LengthAwarePaginator.currentPathResolver = resolver
  }

  /** Resolve default page from static resolver or `1`. */
  public static resolveDefaultPage(pageName?: string): number {
    const raw = LengthAwarePaginator.currentPageResolver?.(pageName)
    if (raw === undefined) return 1
    if (!Number.isFinite(raw)) return 1
    return Math.floor(raw)
  }

  public total(): number {
    return this.totalCount
  }

  public currentPage(): number {
    return this.currentPageNumber
  }

  public lastPage(): number {
    if (this.totalCount === 0) return 1
    return Math.max(1, Math.ceil(this.totalCount / this.perPageCount))
  }

  public from(): number | null {
    if (this.totalCount === 0 || this.pageItems.length === 0) return null
    return (this.currentPageNumber - 1) * this.perPageCount + 1
  }

  public to(): number | null {
    const f = this.from()
    if (f === null) return null
    return f + this.pageItems.length - 1
  }

  public hasMorePages(): boolean {
    return this.currentPageNumber < this.lastPage()
  }

  public hasPages(): boolean {
    return this.totalCount > 0
  }

  public onFirstPage(): boolean {
    return this.currentPageNumber <= 1
  }

  public onLastPage(): boolean {
    return this.currentPageNumber >= this.lastPage()
  }

  public url(page: number): string {
    const built = buildPaginatorUrl(
      this.currentPath,
      this.queryParams,
      'page',
      String(page),
      this.fragmentString,
    )
    return built ?? this.currentPath
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

  public firstPageUrl(): string {
    return (
      buildPaginatorUrl(this.currentPath, this.queryParams, 'page', '1', this.fragmentString) ??
      this.currentPath
    )
  }

  public lastPageUrl(): string {
    return (
      buildPaginatorUrl(
        this.currentPath,
        this.queryParams,
        'page',
        String(this.lastPage()),
        this.fragmentString,
      ) ?? this.currentPath
    )
  }

  public toJSON(): PaginatedResponse<T> {
    return {
      data: this.pageItems,
      meta: {
        currentPage: this.currentPageNumber,
        perPage: this.perPageCount,
        total: this.totalCount,
        lastPage: this.lastPage(),
        from: this.from(),
        to: this.to(),
        hasMorePages: this.hasMorePages(),
        path: this.currentPath,
      },
      links: {
        first: this.hasPages() ? this.firstPageUrl() : null,
        last: this.hasPages() ? this.lastPageUrl() : null,
        prev: this.previousPageUrl(),
        next: this.nextPageUrl(),
      },
    }
  }
}
