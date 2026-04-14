/**
 * Primary user-facing query builder factory for `@atlex/orm`.
 */

import { ConnectionRegistry } from './ConnectionRegistry.js'
import { QueryBuilder } from './QueryBuilder.js'

/**
 * Create a new `QueryBuilder` using the default connection.
 *
 * @param table - Optional table name to immediately target.
 * @returns A new `QueryBuilder`.
 * @example
 * const users = await db('users').where('active', true).get()
 */
export function db(table?: string): QueryBuilder {
  const conn = ConnectionRegistry.instance().default()
  const qb = new QueryBuilder(conn)
  const trx = ConnectionRegistry.instance().activeTestTransaction()
  if (trx !== null) {
    qb.withTransaction(trx)
  }
  if (table !== undefined) qb.table(table)
  return qb
}
