/**
 * Build pagination URLs with merged query parameters and optional fragment.
 */

function mergeQueryIntoPath(path: string, extra: Record<string, string>): string {
  if (Object.keys(extra).length === 0) return path
  const parts = path.split('?', 2)
  const pathname = parts[0] ?? path
  const existingQs = parts[1]
  const params = new URLSearchParams(existingQs ?? '')
  for (const [k, v] of Object.entries(extra)) {
    params.set(k, v)
  }
  const qs = params.toString()
  return qs.length > 0 ? `${pathname}?${qs}` : pathname
}

function appendFragment(path: string, fragment: string | null): string {
  if (fragment === null || fragment.length === 0) return path
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment
  return `${path}#${raw}`
}

/**
 * Merge base path, query map, single key override, and fragment into one URL string.
 */
export function buildPaginatorUrl(
  path: string,
  query: Record<string, string>,
  pageKey: string,
  pageValue: string | null,
  fragment: string | null,
): string | null {
  if (pageValue === null) return null
  const merged = { ...query, [pageKey]: pageValue }
  return appendFragment(mergeQueryIntoPath(path, merged), fragment)
}

/**
 * Merge cursor query parameter into path.
 */
export function buildCursorUrl(
  path: string,
  query: Record<string, string>,
  cursorName: string,
  encodedCursor: string | null,
  fragment: string | null,
): string | null {
  if (encodedCursor === null) return null
  const merged = { ...query, [cursorName]: encodedCursor }
  return appendFragment(mergeQueryIntoPath(path, merged), fragment)
}
