import { AbstractPaginator } from './AbstractPaginator.js'
import { type Cursor } from './Cursor.js'
import { LengthAwarePaginator } from './LengthAwarePaginator.js'
import type { CursorPaginatedResponse, CursorPaginationOptions } from './PaginationMeta.js'
import { buildCursorUrl } from './urlHelpers.js'

/**
 * Cursor-based paginator (keyset / seek pagination).
 */
export class CursorPaginator<T> extends AbstractPaginator<T> {
  private readonly next: Cursor | null
  private readonly previous: Cursor | null
  private readonly more: boolean
  private readonly cursorParamName: string

  /**
   * @param items - Current page items (length ≤ perPage).
   * @param perPage - Requested page size.
   * @param next - Cursor for the following page, or null.
   * @param previous - Cursor for the preceding page, or null.
   * @param hasMore - True when a next page exists.
   * @param options - Path, query, cursor param name, fragment.
   */
  public constructor(
    items: T[],
    perPage: number,
    next: Cursor | null,
    previous: Cursor | null,
    hasMore: boolean,
    options?: CursorPaginationOptions,
  ) {
    const path = LengthAwarePaginator.resolvePath(options?.path)
    super(items, perPage, path, options?.query ?? {}, null)
    this.next = next
    this.previous = previous
    this.more = hasMore
    this.cursorParamName = options?.cursorName ?? 'cursor'
    if (options?.fragment !== undefined && options.fragment !== null) {
      this.fragment(options.fragment)
    }
  }

  public nextCursor(): Cursor | null {
    return this.next
  }

  public previousCursor(): Cursor | null {
    return this.previous
  }

  public nextPageUrl(): string | null {
    const enc = this.next?.encode() ?? null
    return buildCursorUrl(
      this.currentPath,
      this.queryParams,
      this.cursorParamName,
      enc,
      this.fragmentString,
    )
  }

  public previousPageUrl(): string | null {
    const enc = this.previous?.encode() ?? null
    return buildCursorUrl(
      this.currentPath,
      this.queryParams,
      this.cursorParamName,
      enc,
      this.fragmentString,
    )
  }

  public hasMore(): boolean {
    return this.more
  }

  public hasPages(): boolean {
    return this.pageItems.length > 0
  }

  public toJSON(): CursorPaginatedResponse<T> {
    return {
      data: this.pageItems,
      meta: {
        perPage: this.perPageCount,
        hasMore: this.more,
        nextCursor: this.next?.encode() ?? null,
        previousCursor: this.previous?.encode() ?? null,
        path: this.currentPath,
      },
      links: {
        prev: this.previousPageUrl(),
        next: this.nextPageUrl(),
      },
    }
  }
}
