/**
 * JSON-serializable pagination response shapes (JSON:API–friendly).
 */

/** Shared response shape for offset-based pagination. */
export interface PaginatedResponse<T> {
  data: T[]
  meta: {
    currentPage: number
    perPage: number
    total: number
    lastPage: number
    from: number | null
    to: number | null
    hasMorePages: boolean
    path: string
  }
  links: {
    first: string | null
    last: string | null
    prev: string | null
    next: string | null
  }
}

/** Response shape for simple pagination (no total). */
export interface SimplePaginatedResponse<T> {
  data: T[]
  meta: {
    currentPage: number
    perPage: number
    hasMorePages: boolean
    from: number | null
    to: number | null
    path: string
  }
  links: {
    prev: string | null
    next: string | null
  }
}

/** Response shape for cursor pagination. */
export interface CursorPaginatedResponse<T> {
  data: T[]
  meta: {
    perPage: number
    hasMore: boolean
    nextCursor: string | null
    previousCursor: string | null
    path: string
  }
  links: {
    prev: string | null
    next: string | null
  }
}

/** Options for offset paginators. */
export interface PaginationOptions {
  page?: number
  path?: string
  query?: Record<string, string>
  fragment?: string
}

/** Options for cursor pagination. */
export interface CursorPaginationOptions {
  cursor?: string | null
  path?: string
  query?: Record<string, string>
  fragment?: string | null
  cursorName?: string
  /** When no `orderBy` is set, used as the default seek column (Model passes `primaryKey`). */
  primaryKeyColumn?: string
}
