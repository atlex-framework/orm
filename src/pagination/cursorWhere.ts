import type { QueryBuilder } from '../QueryBuilder.js'

type Direction = 'asc' | 'desc'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Append a compound keyset `WHERE` for cursor pagination (`OR` of tuple comparisons).
 *
 * @param qb - Target query builder.
 * @param columns - Sort columns in order.
 * @param directions - Sort direction per column.
 * @param values - Bound values for each column (same order).
 * @param forward - When true, seek forward along the user-facing sort order.
 */
export function applyKeysetWhere<TResult = Record<string, unknown>>(
  qb: QueryBuilder<TResult>,
  columns: readonly string[],
  directions: readonly Direction[],
  values: readonly unknown[],
  forward: boolean,
): void {
  if (columns.length === 0) return
  qb.where((outer) => {
    for (let i = 0; i < columns.length; i++) {
      outer.orWhere((branch) => {
        for (let j = 0; j < i; j++) {
          const cj = columns[j]
          const vj = values[j]
          if (cj === undefined || vj === undefined) continue
          branch.where(cj, '=', vj)
        }
        const col = columns[i]
        const vi = values[i]
        const dir = directions[i]
        if (col === undefined || vi === undefined || dir === undefined) {
          return
        }
        const isAsc = dir === 'asc'
        const useGreater = forward === isAsc
        const op = useGreater ? '>' : '<'
        branch.where(col, op, vi)
      })
    }
  })
}

/**
 * Read sort-column values from a row or a hydrated Model for cursor encoding.
 */
export function rowToPlainRecord(
  row: unknown,
  columns: readonly string[],
): Record<string, unknown> {
  if (typeof row !== 'object' || row === null) {
    return Object.fromEntries(columns.map((c) => [c, undefined]))
  }
  const r = row as Record<string, unknown> & { getAttribute?: (k: string) => unknown }
  if (typeof r.getAttribute === 'function') {
    const out: Record<string, unknown> = {}
    for (const c of columns) {
      out[c] = r.getAttribute(c)
    }
    return out
  }
  if (!isRecord(r)) {
    return Object.fromEntries(columns.map((c) => [c, undefined]))
  }
  const out: Record<string, unknown> = {}
  for (const c of columns) {
    out[c] = r[c]
  }
  return out
}

export function invertDirections(directions: readonly Direction[]): Direction[] {
  return directions.map((d) => (d === 'asc' ? 'desc' : 'asc'))
}
