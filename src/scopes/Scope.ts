/**
 * Scope contracts for `@atlex/orm`.
 *
 * Scopes provide reusable query constraints that are applied automatically
 * (global scopes) or explicitly (local scopes).
 */

import type { Model } from '../Model.js'
import type { QueryBuilder } from '../QueryBuilder.js'

export interface Scope {
  /**
   * Apply the scope constraints to a query builder.
   *
   * @param builder - Query builder to constrain.
   * @param model - Model class the scope is being applied to.
   * @returns void
   * @example
   * apply(qb) { qb.where('active', '=', true) }
   */
  apply(builder: QueryBuilder, model: typeof Model): void
}
