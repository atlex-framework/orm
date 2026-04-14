/**
 * Shared public types for `@atlex/orm`.
 */

import type { Model } from './Model.js'
import type { Scope } from './scopes/Scope.js'

/**
 * Legacy offset pagination shape.
 *
 * @deprecated Prefer `LengthAwarePaginator` / `QueryBuilder.paginate()` for API responses.
 */
export interface PaginationResult<T> {
  data: T[]
  total: number
  per_page: number
  current_page: number
  last_page: number
  from: number
  to: number
}

/**
 * Constructor type for static method generics.
 */
export interface ModelConstructor<T extends Model> {
  new (): T
  table: string
  primaryKey: string
  timestamps: boolean
  incrementing: boolean
  hidden: string[]
  fillable: string[]
  guarded: string[]
  appends?: string[]
  [key: string]: unknown
}

/**
 * Pivot data shape for many-to-many relationships.
 */
export type PivotData = Record<string, unknown>

/**
 * Query scope interface.
 */
export type { Scope }
