/**
 * Shared behaviour for all paginator implementations.
 */
export abstract class AbstractPaginator<T> {
  protected readonly pageItems: T[]
  protected perPageCount: number
  protected currentPath: string
  protected queryParams: Record<string, string>
  protected fragmentString: string | null

  /**
   * @param items - Items for the current page.
   * @param perPage - Requested page size.
   * @param path - Base URL path (may include existing query string).
   * @param query - Extra query parameters merged into generated URLs.
   * @param fragment - Optional URL fragment (without `#`).
   */
  protected constructor(
    items: T[],
    perPage: number,
    path: string,
    query: Record<string, string> = {},
    fragment: string | null = null,
  ) {
    this.pageItems = items
    this.perPageCount = perPage
    this.currentPath = path
    this.queryParams = { ...query }
    this.fragmentString = fragment
  }

  /** Items on the current page. */
  public items(): T[] {
    return [...this.pageItems]
  }

  /** Number of items on this page. */
  public count(): number {
    return this.pageItems.length
  }

  public isEmpty(): boolean {
    return this.pageItems.length === 0
  }

  public isNotEmpty(): boolean {
    return this.pageItems.length > 0
  }

  public perPage(): number {
    return this.perPageCount
  }

  /**
   * Append query string values used when building pagination links.
   */
  public appends(key: string | Record<string, string>, value?: string): this {
    if (typeof key === 'string') {
      if (value === undefined) return this
      this.queryParams[key] = value
      return this
    }
    Object.assign(this.queryParams, key)
    return this
  }

  /** Replace the base path used for links. */
  public withPath(path: string): this {
    this.currentPath = path
    return this
  }

  /**
   * Merge query values from the optional global resolver (e.g. current HTTP request).
   */
  public withQueryString(): this {
    const extra = AbstractPaginator.currentQueryResolver?.()
    if (extra !== undefined) {
      Object.assign(this.queryParams, extra)
    }
    return this
  }

  /** Set the URL fragment appended to generated links. */
  public fragment(fragment: string | null): this {
    this.fragmentString = fragment
    return this
  }

  public firstItem(): T | undefined {
    return this.pageItems[0]
  }

  public lastItem(): T | undefined {
    return this.pageItems.length === 0 ? undefined : this.pageItems[this.pageItems.length - 1]
  }

  public *[Symbol.iterator](): Iterator<T> {
    for (const item of this.pageItems) {
      yield item
    }
  }

  public map<U>(callback: (item: T, index: number) => U): U[] {
    return this.pageItems.map(callback)
  }

  /** @internal */
  public static currentQueryResolver: (() => Record<string, string>) | undefined

  /**
   * Register a resolver that {@link withQueryString} merges into link URLs.
   */
  public static resolveQueryString(resolver: () => Record<string, string>): void {
    AbstractPaginator.currentQueryResolver = resolver
  }

  public abstract toJSON(): unknown
}
