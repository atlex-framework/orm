/**
 * Fluent SQL query builder for `@atlex/orm`.
 *
 * Provides an opinionated, chainable API over a private Knex instance, without
 * exposing Knex types in the public surface.
 */

import { createRequire } from 'node:module'

import type { Knex } from 'knex'

import { type Connection } from './Connection.js'
import { NotFoundException } from './exceptions/NotFoundException.js'
import { QueryException } from './exceptions/QueryException.js'
import { Cursor } from './pagination/Cursor.js'
import { CursorPaginator } from './pagination/CursorPaginator.js'
import { applyKeysetWhere, invertDirections, rowToPlainRecord } from './pagination/cursorWhere.js'
import { LengthAwarePaginator } from './pagination/LengthAwarePaginator.js'
import type { CursorPaginationOptions, PaginationOptions } from './pagination/PaginationMeta.js'
import { Paginator } from './pagination/Paginator.js'

type Direction = 'asc' | 'desc'

/** Narrow shape for optional `@atlex/config` (avoid compile-time module dependency). */
interface AtlexConfigModuleShape {
  config: (key: string, defaultValue?: unknown) => unknown
}

const requireAtlexConfig = createRequire(import.meta.url)

function tryConfigDatabasePerPage(): number | undefined {
  try {
    const { config } = requireAtlexConfig('@atlex/config') as AtlexConfigModuleShape
    const v = config('database.pagination.perPage', LengthAwarePaginator.defaultPerPage)
    if (typeof v === 'number' && Number.isFinite(v)) {
      return Math.max(1, Math.floor(v))
    }
  } catch {
    /* @atlex/config is optional for standalone ORM use */
  }
  return undefined
}

function resolvePerPage(perPage?: number): number {
  if (perPage !== undefined && Number.isFinite(perPage)) {
    return Math.max(1, Math.floor(perPage))
  }
  return tryConfigDatabasePerPage() ?? LengthAwarePaginator.defaultPerPage
}

function resolveRequestedPage(options?: PaginationOptions): number {
  if (options?.page !== undefined && Number.isFinite(options.page)) {
    return Math.floor(options.page)
  }
  return LengthAwarePaginator.resolveDefaultPage()
}

interface CompiledSQL {
  sql: string
  bindings: unknown[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isRawBinding(value: unknown): value is Knex.RawBinding {
  if (value === null) return true
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint') return true
  if (value instanceof Date) return true
  if (value instanceof Uint8Array) return true // includes Node.js Buffer
  return false
}

function toRawBindings(bindings?: readonly unknown[]): Knex.RawBinding[] {
  if (bindings === undefined) return []
  const out: Knex.RawBinding[] = []
  for (const b of bindings) {
    if (!isRawBinding(b)) {
      throw new Error(
        'QueryBuilder error: invalid raw binding type. Allowed: string | number | boolean | bigint | Date | Uint8Array | null.',
      )
    }
    out.push(b)
  }
  return out
}

function toValuesArray(values?: readonly unknown[]): Knex.Value[] {
  if (values === undefined) return []
  return values.map(toValue)
}

function isValue(value: unknown): value is Knex.Value {
  // Knex's Value type is permissive across dialects. We still guard the most common safe primitives.
  return isRawBinding(value) || value === undefined
}

function toValue(value: unknown): Knex.Value {
  if (!isValue(value)) {
    throw new Error(
      'QueryBuilder error: invalid value type. Allowed: string | number | boolean | bigint | Date | Uint8Array | null.',
    )
  }
  return value
}

function assertTableSet(table: string | null): string {
  if (table === null || table.trim().length === 0) {
    throw new Error('QueryBuilder error: no table selected. Call `.table("...")` first.')
  }
  return table
}

function toNumberOrThrow(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && value.trim().length > 0) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  throw new Error(`QueryBuilder error: unable to parse ${label} as a number.`)
}

/**
 * Opaque raw SQL expression usable inside `select`, `whereRaw`, etc.
 * This is an Atlex wrapper around a Knex raw expression.
 */
export class RawExpression {
  private readonly native: Knex.Raw

  /** @internal */
  public constructor(native: Knex.Raw) {
    this.native = native
  }

  /** @internal */
  public _native(): Knex.Raw {
    return this.native
  }
}

type ColumnExpression = string | RawExpression
type Apply = (qb: Knex.QueryBuilder) => void

interface BuilderState {
  table: string | null
  select: ColumnExpression[]
  distinct: boolean
  wheres: Apply[]
  joins: Apply[]
  groups: string[]
  havings: Apply[]
  orders: Apply[]
  structuredOrders: { column: string; direction: Direction }[]
  limit: number | null
  offset: number | null
  lock: 'forUpdate' | 'share' | null
  trx: Knex.Transaction | null
  mapRow: ((row: Record<string, unknown>) => unknown) | null
  afterFetch: ((rows: unknown[]) => Promise<void>) | null
}

function cloneState(state: BuilderState): BuilderState {
  return {
    table: state.table,
    select: [...state.select],
    distinct: state.distinct,
    wheres: [...state.wheres],
    joins: [...state.joins],
    groups: [...state.groups],
    havings: [...state.havings],
    orders: [...state.orders],
    structuredOrders: [...state.structuredOrders],
    limit: state.limit,
    offset: state.offset,
    lock: state.lock,
    trx: state.trx,
    mapRow: state.mapRow,
    afterFetch: state.afterFetch,
  }
}

export class QueryBuilder<TResult = Record<string, unknown>> {
  private state: BuilderState

  /**
   * Create a new QueryBuilder.
   *
   * @param connection - Connection to build queries against.
   */
  public constructor(private readonly connection: Connection) {
    this.state = {
      table: null,
      select: ['*'],
      distinct: false,
      wheres: [],
      joins: [],
      groups: [],
      havings: [],
      orders: [],
      structuredOrders: [],
      limit: null,
      offset: null,
      lock: null,
      trx: null,
      mapRow: null,
      afterFetch: null,
    }
  }

  /**
   * Clone the current builder. The clone is independent and can be mutated
   * without affecting the original builder instance.
   *
   * @returns A deep copy of this builder.
   * @example
   * const base = db('users').where('active', true)
   * const admins = base.clone().where('role', 'admin')
   */
  public clone(): QueryBuilder<TResult> {
    const qb = new QueryBuilder<TResult>(this.connection)
    qb.state = cloneState(this.state)
    return qb
  }

  /**
   * Run all subsequent queries on an existing Knex transaction (used by test helpers).
   *
   * @param trx - Open transaction.
   * @returns This builder (fluent).
   */
  public withTransaction(trx: Knex.Transaction): this {
    this.state.trx = trx
    return this
  }

  /**
   * Execute a callback within a database transaction.
   *
   * @param callback - Callback executed inside a transaction.
   * @returns The callback result.
   * @example
   * await db('users').transaction(async (trx) => trx.where('id', 1).lockForUpdate().first())
   */
  public async transaction<T>(callback: (qb: QueryBuilder<TResult>) => Promise<T>): Promise<T> {
    const k = this.connection._knex()
    return await k.transaction(async (trx) => {
      const scoped = this.clone()
      scoped.state.trx = trx
      return await callback(scoped)
    })
  }

  /**
   * @internal Configure a row mapper for terminal read methods.
   */
  public _mapRow<TNext>(mapper: (row: Record<string, unknown>) => TNext): QueryBuilder<TNext> {
    const next = new QueryBuilder<TNext>(this.connection)
    next.state = cloneState(this.state)
    next.state.mapRow = mapper as unknown as (row: Record<string, unknown>) => unknown
    return next
  }

  /**
   * @internal Configure an after-fetch hook used for eager loading.
   */
  public _afterFetch(callback: (rows: TResult[]) => Promise<void>): this {
    this.state.afterFetch = callback as unknown as (rows: unknown[]) => Promise<void>
    return this
  }

  /**
   * Create a raw SQL expression with optional bindings.
   *
   * @param sql - Raw SQL fragment.
   * @param bindings - Optional bindings for placeholders.
   * @returns An opaque raw expression usable in this query builder.
   * @example
   * db('users').select(db('users').raw('COUNT(*) as total')).first()
   */
  public raw(sql: string, bindings?: readonly unknown[]): RawExpression {
    const native = this.connection._knex().raw(sql, toRawBindings(bindings))
    return new RawExpression(native)
  }

  /**
   * Set the target table for the query (supports `table as alias` syntax).
   *
   * @param name - Table name.
   * @returns this
   * @example
   * db().table('users as u')
   */
  public table(name: string): this {
    this.state.table = name
    return this
  }

  /**
   * Select specific columns (defaults to `*` when no columns are selected).
   *
   * @param columns - Column names (or raw expressions).
   * @returns this
   * @example
   * db('users').select('id', 'email')
   */
  public select(...columns: ColumnExpression[]): this {
    this.state.select = columns.length > 0 ? [...columns] : ['*']
    return this
  }

  /**
   * Add DISTINCT to the select query.
   *
   * @returns this
   * @example
   * db('users').distinct().pluck('email')
   */
  public distinct(): this {
    this.state.distinct = true
    return this
  }

  /**
   * Append columns to the existing select list.
   *
   * @param columns - Columns to append.
   * @returns this
   * @example
   * db('users').select('id').addSelect('email')
   */
  public addSelect(...columns: ColumnExpression[]): this {
    this.state.select.push(...columns)
    return this
  }

  /**
   * Add a WHERE clause.
   *
   * @param column - Column name.
   * @param operatorOrValue - Operator (e.g. `=`, `>`) or the value (shorthand).
   * @param value - Value for the condition.
   * @returns this
   * @example
   * db('users').where('age', '>=', 18)
   */
  public where(column: string, operator: string, value: unknown): this
  public where(column: string, value: unknown): this
  public where(callback: (qb: QueryBuilder) => void): this
  public where(a: string | ((qb: QueryBuilder) => void), b?: string | unknown, c?: unknown): this {
    if (typeof a === 'function') {
      const nested = new QueryBuilder(this.connection)
      callbackGuard(a, nested)
      this.state.wheres.push((qb) => {
        qb.where((inner) => {
          nested.applyWheres(inner)
        })
      })
      return this
    }

    if (typeof b === 'string' && arguments.length === 3) {
      this.state.wheres.push((qb) => {
        qb.where(a, b, toValue(c))
      })
      return this
    }

    this.state.wheres.push((qb) => {
      qb.where(a, '=', toValue(b))
    })
    return this
  }

  /**
   * Add an OR WHERE clause.
   *
   * @param column - Column name.
   * @param operatorOrValue - Operator or value (shorthand).
   * @param value - Value for the condition.
   * @returns this
   * @example
   * db('users').where('role', 'admin').orWhere('role', 'owner')
   */
  public orWhere(column: string, operator: string, value: unknown): this
  public orWhere(column: string, value: unknown): this
  public orWhere(callback: (qb: QueryBuilder) => void): this
  public orWhere(
    a: string | ((qb: QueryBuilder) => void),
    b?: string | unknown,
    c?: unknown,
  ): this {
    if (typeof a === 'function') {
      const nested = new QueryBuilder(this.connection)
      callbackGuard(a, nested)
      this.state.wheres.push((qb) => {
        qb.orWhere((inner) => {
          nested.applyWheres(inner)
        })
      })
      return this
    }

    if (typeof b === 'string' && arguments.length === 3) {
      this.state.wheres.push((qb) => {
        qb.orWhere(a, b, toValue(c))
      })
      return this
    }

    this.state.wheres.push((qb) => {
      qb.orWhere(a, '=', toValue(b))
    })
    return this
  }

  /**
   * Add a negated WHERE clause.
   *
   * @param column - Column name.
   * @param operatorOrValue - Operator or value (shorthand).
   * @param value - Value for the condition.
   * @returns this
   * @example
   * db('users').whereNot('status', 'disabled')
   */
  public whereNot(column: string, operator: string, value: unknown): this
  public whereNot(column: string, value: unknown): this
  public whereNot(column: string, operatorOrValue: string | unknown, value?: unknown): this {
    if (typeof operatorOrValue === 'string' && arguments.length === 3) {
      this.state.wheres.push((qb) => {
        qb.whereNot(column, operatorOrValue, toValue(value))
      })
      return this
    }
    this.state.wheres.push((qb) => {
      qb.whereNot(column, '=', toValue(operatorOrValue))
    })
    return this
  }

  /**
   * Add a WHERE IN clause.
   *
   * @param column - Column name.
   * @param values - Values list.
   * @returns this
   * @example
   * db('users').whereIn('id', [1,2,3])
   */
  public whereIn(column: string, values: readonly unknown[]): this {
    this.state.wheres.push((qb) => {
      qb.whereIn(column, values.map(toValue))
    })
    return this
  }

  /**
   * Add a WHERE NOT IN clause.
   *
   * @param column - Column name.
   * @param values - Values list.
   * @returns this
   * @example
   * db('users').whereNotIn('status', ['disabled', 'banned'])
   */
  public whereNotIn(column: string, values: readonly unknown[]): this {
    this.state.wheres.push((qb) => {
      qb.whereNotIn(column, values.map(toValue))
    })
    return this
  }

  /**
   * Add a WHERE NULL clause.
   *
   * @param column - Column name.
   * @returns this
   * @example
   * db('users').whereNull('deleted_at')
   */
  public whereNull(column: string): this {
    this.state.wheres.push((qb) => {
      qb.whereNull(column)
    })
    return this
  }

  /**
   * Add a WHERE NOT NULL clause.
   *
   * @param column - Column name.
   * @returns this
   * @example
   * db('users').whereNotNull('email_verified_at')
   */
  public whereNotNull(column: string): this {
    this.state.wheres.push((qb) => {
      qb.whereNotNull(column)
    })
    return this
  }

  /**
   * Add a WHERE BETWEEN clause.
   *
   * @param column - Column name.
   * @param range - Inclusive range tuple.
   * @returns this
   * @example
   * db('orders').whereBetween('total', [10, 100])
   */
  public whereBetween(column: string, range: readonly [unknown, unknown]): this {
    this.state.wheres.push((qb) => {
      qb.whereBetween(column, [toValue(range[0]), toValue(range[1])] as [Knex.Value, Knex.Value])
    })
    return this
  }

  /**
   * Add a WHERE NOT BETWEEN clause.
   *
   * @param column - Column name.
   * @param range - Inclusive range tuple.
   * @returns this
   * @example
   * db('orders').whereNotBetween('total', [10, 100])
   */
  public whereNotBetween(column: string, range: readonly [unknown, unknown]): this {
    this.state.wheres.push((qb) => {
      qb.whereNotBetween(column, [toValue(range[0]), toValue(range[1])] as [Knex.Value, Knex.Value])
    })
    return this
  }

  /**
   * Add a WHERE EXISTS subquery.
   *
   * @param callback - Callback that builds the subquery.
   * @returns this
   * @example
   * db('users').whereExists(q => q.table('posts').whereRaw('posts.user_id = users.id'))
   */
  public whereExists(callback: (qb: QueryBuilder) => void): this {
    const nested = new QueryBuilder(this.connection)
    callbackGuard(callback, nested)
    this.state.wheres.push((qb) => {
      qb.whereExists(nested.buildQuery())
    })
    return this
  }

  /**
   * Add a raw WHERE clause with optional bindings.
   *
   * @param sql - SQL fragment.
   * @param bindings - Bindings for placeholders.
   * @returns this
   * @example
   * db('users').whereRaw('email like ?', ['%@example.com'])
   */
  public whereRaw(sql: string, bindings?: readonly unknown[]): this {
    this.state.wheres.push((qb) => {
      qb.whereRaw(sql, toValuesArray(bindings))
    })
    return this
  }

  /**
   * Order the results by a column.
   *
   * @param column - Column name.
   * @param direction - Sort direction.
   * @returns this
   * @example
   * db('users').orderBy('id', 'desc')
   */
  public orderBy(column: string, direction: Direction = 'asc'): this {
    this.state.structuredOrders.push({ column, direction })
    this.state.orders.push((qb) => {
      qb.orderBy(column, direction)
    })
    return this
  }

  /**
   * Order using a raw SQL expression.
   *
   * @param sql - Raw ORDER BY clause.
   * @returns this
   * @example
   * db('users').orderByRaw('FIELD(role, "owner", "admin", "user")')
   */
  public orderByRaw(sql: string): this {
    this.state.structuredOrders = []
    this.state.orders.push((qb) => {
      qb.orderByRaw(sql)
    })
    return this
  }

  /**
   * Remove all `ORDER BY` clauses (offset and cursor pagination helpers).
   *
   * @returns this
   */
  public clearOrder(): this {
    this.state.orders = []
    this.state.structuredOrders = []
    return this
  }

  /**
   * Order by a column descending (default `created_at`).
   *
   * @param column - Column name.
   * @returns this
   * @example
   * db('posts').latest()
   */
  public latest(column = 'created_at'): this {
    return this.orderBy(column, 'desc')
  }

  /**
   * Order by a column ascending (default `created_at`).
   *
   * @param column - Column name.
   * @returns this
   * @example
   * db('posts').oldest()
   */
  public oldest(column = 'created_at'): this {
    return this.orderBy(column, 'asc')
  }

  /**
   * Group results by one or more columns.
   *
   * @param columns - Columns to group by.
   * @returns this
   * @example
   * db('orders').groupBy('user_id')
   */
  public groupBy(...columns: string[]): this {
    this.state.groups.push(...columns)
    return this
  }

  /**
   * Add a HAVING clause.
   *
   * @param column - Column name.
   * @param operator - Operator.
   * @param value - Value.
   * @returns this
   * @example
   * db('orders').groupBy('user_id').having('total', '>', 100)
   */
  public having(column: string, operator: string, value: unknown): this {
    this.state.havings.push((qb) => {
      qb.having(column, operator, toValue(value))
    })
    return this
  }

  /**
   * Add a raw HAVING clause with optional bindings.
   *
   * @param sql - Raw SQL.
   * @param bindings - Bindings.
   * @returns this
   * @example
   * db('orders').groupBy('user_id').havingRaw('SUM(total) > ?', [100])
   */
  public havingRaw(sql: string, bindings?: readonly unknown[]): this {
    this.state.havings.push((qb) => {
      qb.havingRaw(sql, toValuesArray(bindings))
    })
    return this
  }

  /**
   * Limit the number of returned rows.
   *
   * @param n - Max rows.
   * @returns this
   * @example
   * db('users').limit(10)
   */
  public limit(n: number): this {
    this.state.limit = n
    return this
  }

  /**
   * Offset the returned rows.
   *
   * @param n - Offset.
   * @returns this
   * @example
   * db('users').offset(20)
   */
  public offset(n: number): this {
    this.state.offset = n
    return this
  }

  /**
   * Apply limit/offset for a page.
   *
   * @param page - 1-based page number.
   * @param perPage - Items per page (default 15).
   * @returns this
   * @example
   * db('users').forPage(2, 25)
   */
  public forPage(page: number, perPage = 15): this {
    const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1
    const safePerPage = Number.isFinite(perPage) ? Math.max(1, Math.floor(perPage)) : 15
    this.limit(safePerPage)
    this.offset((safePage - 1) * safePerPage)
    return this
  }

  /**
   * Inner join another table.
   *
   * @param table - Table to join.
   * @param first - Left side column.
   * @param operator - Join operator.
   * @param second - Right side column.
   * @returns this
   * @example
   * db('users').join('posts', 'posts.user_id', '=', 'users.id')
   */
  public join(table: string, first: string, operator: string, second: string): this {
    this.state.joins.push((qb) => qb.join(table, first, operator, second))
    return this
  }

  /**
   * Left join another table.
   *
   * @param table - Table to join.
   * @param first - Left side column.
   * @param operator - Join operator.
   * @param second - Right side column.
   * @returns this
   * @example
   * db('users').leftJoin('posts', 'posts.user_id', '=', 'users.id')
   */
  public leftJoin(table: string, first: string, operator: string, second: string): this {
    this.state.joins.push((qb) => qb.leftJoin(table, first, operator, second))
    return this
  }

  /**
   * Right join another table.
   *
   * @param table - Table to join.
   * @param first - Left side column.
   * @param operator - Join operator.
   * @param second - Right side column.
   * @returns this
   * @example
   * db('users').rightJoin('posts', 'posts.user_id', '=', 'users.id')
   */
  public rightJoin(table: string, first: string, operator: string, second: string): this {
    this.state.joins.push((qb) => qb.rightJoin(table, first, operator, second))
    return this
  }

  /**
   * Cross join another table.
   *
   * @param table - Table to cross join.
   * @returns this
   * @example
   * db('a').crossJoin('b')
   */
  public crossJoin(table: string): this {
    this.state.joins.push((qb) => qb.joinRaw('cross join ??', [table]))
    return this
  }

  /**
   * Join using raw SQL.
   *
   * @param sql - Raw join SQL.
   * @param bindings - Bindings for placeholders.
   * @returns this
   * @example
   * db('users').joinRaw('join roles on roles.id = users.role_id')
   */
  public joinRaw(sql: string, bindings?: readonly unknown[]): this {
    this.state.joins.push((qb) => qb.joinRaw(sql, toValuesArray(bindings)))
    return this
  }

  /**
   * Lock selected rows for update (SELECT ... FOR UPDATE).
   *
   * @returns this
   * @example
   * await db('users').where('id', 1).lockForUpdate().first()
   */
  public lockForUpdate(): this {
    this.state.lock = 'forUpdate'
    return this
  }

  /**
   * Acquire a shared lock (FOR SHARE / LOCK IN SHARE MODE depending on driver).
   *
   * @returns this
   * @example
   * await db('users').where('id', 1).sharedLock().first()
   */
  public sharedLock(): this {
    this.state.lock = 'share'
    return this
  }

  /**
   * Run a side-effect callback against this builder without breaking the chain.
   *
   * @param callback - Callback to run.
   * @returns this
   * @example
   * db('users').tap(q => console.log(q.toSQL()))
   */
  public tap(callback: (qb: this) => void): this {
    callback(this)
    return this
  }

  /**
   * Conditionally apply a scope callback.
   *
   * @param condition - Condition to evaluate.
   * @param callback - Scope to apply when condition is true.
   * @param fallback - Optional scope to apply when condition is false.
   * @returns this
   * @example
   * db('users').when(isAdmin, q => q.where('role', 'admin'))
   */
  public when(
    condition: boolean,
    callback: (qb: this) => void,
    fallback?: (qb: this) => void,
  ): this {
    if (condition) callback(this)
    else fallback?.(this)
    return this
  }

  /**
   * Apply a scope unless a condition is true.
   *
   * @param condition - Condition to negate.
   * @param callback - Scope to apply when condition is false.
   * @returns this
   * @example
   * db('users').unless(includeDisabled, q => q.whereNull('disabled_at'))
   */
  public unless(condition: boolean, callback: (qb: this) => void): this {
    if (!condition) callback(this)
    return this
  }

  /**
   * Compile SQL without executing (useful for debugging).
   *
   * @returns SQL + bindings.
   * @example
   * const { sql, bindings } = db('users').where('id', 1).toSQL()
   */
  public toSQL(): CompiledSQL {
    const query = this.buildQuery()
    const compiled = query.toSQL()
    const sql = typeof compiled.sql === 'string' ? compiled.sql : String(compiled.sql)
    const bindings = Array.isArray(compiled.bindings) ? (compiled.bindings as unknown[]) : []
    return { sql, bindings }
  }

  /**
   * Dump the compiled SQL and continue the chain.
   *
   * @returns this
   * @example
   * db('users').where('id', 1).dump().first()
   */
  public dump(): this {
    console.log(this.toSQL())
    return this
  }

  /**
   * Dump the compiled SQL and abort execution.
   *
   * @throws Always throws after logging.
   * @example
   * db('users').where('id', 1).dd()
   */
  public dd(): never {
    console.log(this.toSQL())
    throw new Error('QueryBuilder.dd() called')
  }

  /**
   * Fetch all matching rows.
   *
   * @returns Matching rows.
   * @example
   * const rows = await db('users').get<{ id: number }>()
   */
  public async get<T = TResult>(): Promise<T[]> {
    const result = await this.execute<unknown>(async (query) => await query)
    if (!Array.isArray(result)) return []
    const rows = result as unknown[]
    const mapped = this.state.mapRow
      ? rows.map((r) => this.state.mapRow!(r as Record<string, unknown>)) // runtime-validated by isRecord checks downstream
      : rows
    const typed = mapped as T[]
    if (this.state.afterFetch) await this.state.afterFetch(mapped)
    return typed
  }

  /**
   * Fetch the first matching row or null.
   *
   * @returns First matching row or null.
   * @example
   * const user = await db('users').where('id', 1).first()
   */
  public async first<T = TResult>(): Promise<T | null> {
    const row = await this.execute<unknown>(async (query) => {
      const result = await query.first()
      return result
    })
    if (row === undefined || row === null) return null
    const mapped = this.state.mapRow ? this.state.mapRow(row as Record<string, unknown>) : row
    const typed = mapped as T
    if (this.state.afterFetch) await this.state.afterFetch([mapped])
    return typed
  }

  /**
   * Fetch the first matching row or throw `NotFoundException`.
   *
   * @returns First matching row.
   * @throws NotFoundException
   * @example
   * const user = await db('users').where('email', 'a@b.com').firstOrFail()
   */
  public async firstOrFail<T = TResult>(): Promise<T> {
    const row = await this.first<T>()
    if (row === null) {
      throw new NotFoundException('No records found for the given query.')
    }
    return row
  }

  /**
   * Find a row by primary key (default `id`).
   *
   * @param id - Primary key value.
   * @returns The found row or null.
   * @example
   * const user = await db('users').find(1)
   */
  public async find<T = TResult>(id: number | string): Promise<T | null> {
    return await this.clone().where('id', id).first<T>()
  }

  /**
   * Find a row by primary key or throw `NotFoundException`.
   *
   * @param id - Primary key value.
   * @returns The found row.
   * @throws NotFoundException
   * @example
   * const user = await db('users').findOrFail(1)
   */
  public async findOrFail<T = TResult>(id: number | string): Promise<T> {
    const row = await this.find<T>(id)
    if (row === null) {
      throw new NotFoundException(`Record not found for id "${String(id)}".`)
    }
    return row
  }

  /**
   * Return a single column as a flat array.
   *
   * @param column - Column name.
   * @returns Array of values from the column.
   * @example
   * const ids = await db('users').pluck<number>('id')
   */
  public async pluck<T = unknown>(column: string): Promise<T[]> {
    const rows = await this.clone().select(column).get<Record<string, unknown>>()
    return rows.map((r) => r[column] as T)
  }

  /**
   * Return the first row's column value.
   *
   * @param column - Column name.
   * @returns The value or null.
   * @example
   * const email = await db('users').where('id', 1).value<string>('email')
   */
  public async value<T = unknown>(column: string): Promise<T | null> {
    const row = await this.clone().select(column).first<Record<string, unknown>>()
    if (row === null) return null
    return (row[column] as T) ?? null
  }

  /**
   * Count matching rows.
   *
   * @param column - Column to count (default `*`).
   * @returns Count.
   * @example
   * const total = await db('users').count()
   */
  public async count(column = '*'): Promise<number> {
    const result = await this.executeCount(column, 'count')
    return result
  }

  /**
   * Get the maximum value of a column.
   *
   * @param column - Column name.
   * @returns Maximum value (0 when no rows).
   * @example
   * const maxId = await db('users').max('id')
   */
  public async max(column: string): Promise<number> {
    return await this.executeAggregate(column, 'max')
  }

  /**
   * Get the minimum value of a column.
   *
   * @param column - Column name.
   * @returns Minimum value (0 when no rows).
   * @example
   * const minId = await db('users').min('id')
   */
  public async min(column: string): Promise<number> {
    return await this.executeAggregate(column, 'min')
  }

  /**
   * Get the average value of a column.
   *
   * @param column - Column name.
   * @returns Average value (0 when no rows).
   * @example
   * const avgAge = await db('users').avg('age')
   */
  public async avg(column: string): Promise<number> {
    return await this.executeAggregate(column, 'avg')
  }

  /**
   * Get the sum of a column.
   *
   * @param column - Column name.
   * @returns Sum (0 when no rows).
   * @example
   * const revenue = await db('orders').sum('total')
   */
  public async sum(column: string): Promise<number> {
    return await this.executeAggregate(column, 'sum')
  }

  /**
   * Check whether any records match.
   *
   * @returns True when at least one record exists.
   * @example
   * const hasUsers = await db('users').exists()
   */
  public async exists(): Promise<boolean> {
    const row = await this.clone().select(this.raw('1')).limit(1).first<Record<string, unknown>>()
    return row !== null
  }

  /**
   * Check whether no records match.
   *
   * @returns True when no records exist.
   * @example
   * const empty = await db('users').doesntExist()
   */
  public async doesntExist(): Promise<boolean> {
    return !(await this.exists())
  }

  /**
   * Insert a record or records.
   *
   * For a single object, returns the inserted id.
   * For an array (bulk insert), returns affected row count.
   *
   * @param data - Record or records to insert.
   * @returns Inserted id (single) or row count (bulk).
   * @example
   * const id = await db('users').insert({ email: 'a@b.com' })
   */
  public async insert(data: Record<string, unknown> | Record<string, unknown>[]): Promise<number> {
    if (Array.isArray(data)) {
      const rows = data.map((r) => r)
      const table = assertTableSet(this.state.table) as unknown as Knex.TableDescriptor
      const knex = this.connection._knex()
      const buildInsert = (): Knex.QueryBuilder => {
        let qb = knex(table)
        if (this.state.trx) {
          qb = qb.transacting(this.state.trx)
        }
        return qb
      }
      // Bulk insert must not use `buildQuery()` — it always adds `select('*')`, which breaks Knex insert SQL.
      const compiled = compileSQL(buildInsert().insert(rows), 'insert bulk')
      try {
        const result: unknown = await buildInsert().insert(rows)
        if (this.connection.driver === 'better-sqlite3') {
          return data.length
        }
        return extractRowCountFromInsert(result, data.length)
      } catch (cause) {
        const err = toError(cause)
        throw new QueryException(
          `Database insert failed: ${err.message}`,
          compiled.sql,
          compiled.bindings,
          err,
        )
      }
    }
    return await this.insertGetId(data)
  }

  /**
   * Insert a record and return the new id across pg/mysql/sqlite.
   *
   * @param data - Record to insert.
   * @returns Inserted id.
   * @example
   * const id = await db('users').insertGetId({ email: 'a@b.com' })
   */
  public async insertGetId(data: Record<string, unknown>): Promise<number> {
    const table = assertTableSet(this.state.table) as unknown as Knex.TableDescriptor
    const driver = this.connection.driver
    let query = this.connection._knex()(table)
    if (this.state.trx) {
      query = query.transacting(this.state.trx)
    }
    const compiled = compileSQL(
      query.insert(data),
      driver === 'pg' ? 'insert returning id' : 'insert',
    )

    try {
      if (driver === 'pg') {
        const rows: unknown = await query.insert(data).returning('id')
        return extractInsertedId(driver, rows)
      }
      const result: unknown = await query.insert(data)
      return extractInsertedId(driver, result)
    } catch (cause) {
      const err = toError(cause)
      throw new QueryException(
        `Database insert failed: ${err.message}`,
        compiled.sql,
        compiled.bindings,
        err,
      )
    }
  }

  /**
   * Update matching rows.
   *
   * @param data - Partial update data.
   * @returns Number of affected rows.
   * @example
   * const updated = await db('users').where('id', 1).update({ name: 'New' })
   */
  public async update(data: Record<string, unknown>): Promise<number> {
    const result = await this.execute<unknown>(async (query) => await query.update(data))
    return extractAffectedRows(result)
  }

  /**
   * Update a record matching `search`, or insert if none exists.
   *
   * @param search - Search criteria.
   * @param data - Data to update/insert.
   * @returns void
   * @example
   * await db('settings').updateOrInsert({ key: 'site_name' }, { value: 'Atlex' })
   */
  public async updateOrInsert(
    search: Record<string, unknown>,
    data: Record<string, unknown>,
  ): Promise<void> {
    const updateCount = await this.clone().applySearch(search).update(data)
    if (updateCount > 0) return
    await this.clone().insert({ ...search, ...data })
  }

  /**
   * Increment a numeric column.
   *
   * @param column - Column name.
   * @param amount - Amount (default 1).
   * @returns Number of affected rows.
   * @example
   * await db('users').where('id', 1).increment('login_count')
   */
  public async increment(column: string, amount = 1): Promise<number> {
    const result = await this.execute<unknown>(
      async (query) => await query.increment(column, amount),
    )
    return extractAffectedRows(result)
  }

  /**
   * Decrement a numeric column.
   *
   * @param column - Column name.
   * @param amount - Amount (default 1).
   * @returns Number of affected rows.
   * @example
   * await db('users').where('id', 1).decrement('credits', 5)
   */
  public async decrement(column: string, amount = 1): Promise<number> {
    const result = await this.execute<unknown>(
      async (query) => await query.decrement(column, amount),
    )
    return extractAffectedRows(result)
  }

  /**
   * Delete matching rows.
   *
   * @returns Number of deleted rows.
   * @example
   * const deleted = await db('sessions').where('user_id', 1).delete()
   */
  public async delete(): Promise<number> {
    const result = await this.execute<unknown>(async (query) => await query.delete())
    return extractAffectedRows(result)
  }

  /**
   * Truncate the table.
   *
   * @returns void
   * @example
   * await db('logs').truncate()
   */
  public async truncate(): Promise<void> {
    await this.execute<void>(async (query) => {
      await query.truncate()
    })
  }

  /**
   * Paginate with total count (COUNT + paged SELECT).
   *
   * @param perPage - Items per page (default {@link LengthAwarePaginator.defaultPerPage}).
   * @param options.page - 1-based page (default from resolver or `1`).
   * @example
   * const p = await db('users').where('active', true).paginate(15, { page: 2 })
   */
  public async paginate<T = TResult>(
    perPage?: number,
    options?: PaginationOptions,
  ): Promise<LengthAwarePaginator<T>> {
    const safePer = resolvePerPage(perPage)
    const requestedPage = resolveRequestedPage(options)
    const path = LengthAwarePaginator.resolvePath(options?.path)

    const total = await this.clone().count()
    const lastPage = total === 0 ? 1 : Math.max(1, Math.ceil(total / safePer))

    let data: T[] = []
    if (Number.isFinite(requestedPage) && requestedPage >= 1 && requestedPage <= lastPage) {
      data = await this.clone().forPage(requestedPage, safePer).get<T>()
    }

    return new LengthAwarePaginator<T>(data, total, safePer, requestedPage, {
      ...options,
      path,
    })
  }

  /**
   * Simple pagination: one query with `LIMIT perPage + 1` (no COUNT).
   */
  public async simplePaginate<T = TResult>(
    perPage?: number,
    options?: PaginationOptions,
  ): Promise<Paginator<T>> {
    const safePer = resolvePerPage(perPage)
    const requestedPage = resolveRequestedPage(options)
    const path = LengthAwarePaginator.resolvePath(options?.path)

    if (!Number.isFinite(requestedPage) || requestedPage < 1) {
      return new Paginator<T>([], safePer, requestedPage, false, { ...options, path })
    }

    const offset = (requestedPage - 1) * safePer
    const rows = await this.clone()
      .offset(offset)
      .limit(safePer + 1)
      .get<T>()
    const hasMore = rows.length > safePer
    const slice = hasMore ? rows.slice(0, safePer) : rows
    return new Paginator<T>(slice, safePer, requestedPage, hasMore, { ...options, path })
  }

  /**
   * Cursor (keyset) pagination using the current `orderBy` columns, or `primaryKeyColumn` / `id`.
   */
  public async cursorPaginate<T = TResult>(
    perPage?: number,
    options?: CursorPaginationOptions,
  ): Promise<CursorPaginator<T>> {
    const safePer = resolvePerPage(perPage)
    const pk = options?.primaryKeyColumn ?? 'id'
    const baseOrders = [...this.state.structuredOrders]
    const orders =
      baseOrders.length > 0 ? baseOrders : [{ column: pk, direction: 'asc' as Direction }]
    const columns = orders.map((o) => o.column)
    const directions = orders.map((o) => o.direction)

    let cursor: Cursor | null = null
    const rawCursor = options?.cursor
    if (rawCursor !== undefined && rawCursor !== null && String(rawCursor).length > 0) {
      cursor = Cursor.decode(String(rawCursor))
    }

    const forward = cursor === null || cursor.pointsToNextItems()
    const invertedDirs = invertDirections(directions)
    const sqlOrders: { column: string; direction: Direction }[] = forward
      ? orders
      : columns.map((column, i) => ({ column, direction: invertedDirs[i] ?? 'asc' }))

    const work = this.clone().clearOrder()
    for (const o of sqlOrders) {
      work.orderBy(o.column, o.direction)
    }

    if (cursor !== null) {
      const vals = columns.map((c) => cursor.parameter(c))
      applyKeysetWhere(work, columns, directions, vals, forward)
    }

    const rows = await work.limit(safePer + 1).get<T>()
    const pageRows = forward ? rows : [...rows].reverse()
    const hasExtra = pageRows.length > safePer
    const hasMore = hasExtra
    const items = hasExtra ? pageRows.slice(0, safePer) : pageRows

    let next: Cursor | null = null
    let previous: Cursor | null = null
    if (items.length > 0) {
      const lastPlain = rowToPlainRecord(items[items.length - 1], columns)
      const firstPlain = rowToPlainRecord(items[0], columns)
      if (hasMore) {
        next = Cursor.fromItem(lastPlain, columns, true)
      }
      if (cursor !== null) {
        previous = Cursor.fromItem(firstPlain, columns, false)
      }
    }

    return new CursorPaginator<T>(items, safePer, next, previous, hasMore, options)
  }

  // -------------------------
  // Internals
  // -------------------------

  private applySearch(search: Record<string, unknown>): this {
    for (const [k, v] of Object.entries(search)) {
      this.where(k, v)
    }
    return this
  }

  /** @internal */
  private applyWheres(qb: Knex.QueryBuilder): void {
    for (const apply of this.state.wheres) apply(qb)
  }

  /** @internal */
  private buildQuery(): Knex.QueryBuilder {
    const table = assertTableSet(this.state.table) as unknown as Knex.TableDescriptor
    const k = this.connection._knex()
    const qb = k(table)
    if (this.state.trx) qb.transacting(this.state.trx)

    if (this.state.distinct) qb.distinct()

    const selectArgs: (string | Knex.Raw)[] = this.state.select.map((c) =>
      c instanceof RawExpression ? c._native() : c,
    )
    qb.select(selectArgs)

    for (const j of this.state.joins) j(qb)
    for (const w of this.state.wheres) w(qb)
    if (this.state.groups.length > 0) qb.groupBy(this.state.groups)
    for (const h of this.state.havings) h(qb)
    for (const o of this.state.orders) o(qb)

    if (this.state.limit !== null) qb.limit(this.state.limit)
    if (this.state.offset !== null) qb.offset(this.state.offset)

    if (this.state.lock === 'forUpdate') qb.forUpdate()
    if (this.state.lock === 'share') qb.forShare()

    return qb
  }

  private async execute<T>(runner: (query: Knex.QueryBuilder) => Promise<T>): Promise<T> {
    const query = this.buildQuery()
    const { sql, bindings } = this.toSQL()
    try {
      return await runner(query)
    } catch (cause) {
      const err = toError(cause)
      throw new QueryException(`Database query failed: ${err.message}`, sql, bindings, err)
    }
  }

  private async executeCount(column: string, kind: 'count'): Promise<number> {
    assertTableSet(this.state.table)
    const base = this.buildQuery()
    const { sql, bindings } = this.toSQL()
    try {
      const rows = (await base
        .clone()
        .clearSelect()
        .clearOrder()
        .count({ total: column })) as unknown
      const total = extractAggregate(rows, 'total')
      return toNumberOrThrow(total, kind)
    } catch (cause) {
      const err = toError(cause)
      throw new QueryException(`Database ${kind} failed: ${err.message}`, sql, bindings, err)
    }
  }

  private async executeAggregate(
    column: string,
    kind: 'max' | 'min' | 'avg' | 'sum',
  ): Promise<number> {
    assertTableSet(this.state.table)
    const base = this.buildQuery()
    const { sql, bindings } = this.toSQL()
    try {
      const rows =
        kind === 'max'
          ? ((await base.clone().clearSelect().clearOrder().max({ total: column })) as unknown)
          : kind === 'min'
            ? ((await base.clone().clearSelect().clearOrder().min({ total: column })) as unknown)
            : kind === 'avg'
              ? ((await base.clone().clearSelect().clearOrder().avg({ total: column })) as unknown)
              : ((await base.clone().clearSelect().clearOrder().sum({ total: column })) as unknown)
      const total = extractAggregate(rows, 'total')
      return toNumberOrThrow(total ?? 0, kind)
    } catch (cause) {
      const err = toError(cause)
      throw new QueryException(`Database ${kind} failed: ${err.message}`, sql, bindings, err)
    }
  }
}

function callbackGuard(cb: (qb: QueryBuilder) => void, qb: QueryBuilder): void {
  try {
    cb(qb)
  } catch (e) {
    throw e
  }
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value
  return new Error(typeof value === 'string' ? value : 'Unknown database error')
}

function extractAggregate(rows: unknown, alias: string): unknown {
  if (!Array.isArray(rows) || rows.length === 0) return undefined
  const first = rows[0]
  if (!isRecord(first)) return undefined
  return first[alias]
}

function extractAffectedRows(result: unknown): number {
  if (typeof result === 'number') return result
  if (typeof result === 'bigint') return Number(result)
  if (Array.isArray(result)) return result.length
  if (isRecord(result) && typeof result.rowCount === 'number') return result.rowCount
  return 0
}

function extractRowCountFromInsert(result: unknown, fallback: number): number {
  if (typeof result === 'number') return result
  if (typeof result === 'bigint') return Number(result)
  if (Array.isArray(result)) return result.length
  if (isRecord(result) && typeof result.rowCount === 'number') return result.rowCount
  if (isRecord(result) && typeof result.affectedRows === 'number') return result.affectedRows
  return fallback
}

function extractInsertedId(driver: string, result: unknown): number {
  if (driver === 'pg') {
    if (Array.isArray(result) && result.length > 0) {
      const first = result[0]
      if (typeof first === 'number') return first
      if (typeof first === 'bigint') return Number(first)
      if (isRecord(first) && 'id' in first) {
        return toNumberOrThrow(first.id, 'insert id')
      }
    }
    throw new Error('Database insert failed: unable to read inserted id from PostgreSQL result.')
  }

  if (isRecord(result) && 'insertId' in result) {
    return toNumberOrThrow(result.insertId, 'insert id')
  }

  if (Array.isArray(result) && result.length > 0) {
    const first = result[0]
    return toNumberOrThrow(first, 'insert id')
  }

  if (typeof result === 'number' || typeof result === 'bigint' || typeof result === 'string') {
    return toNumberOrThrow(result, 'insert id')
  }

  if (driver === 'better-sqlite3' && isRecord(result) && 'lastInsertRowid' in result) {
    return toNumberOrThrow(result.lastInsertRowid, 'insert id')
  }

  throw new Error(`Database insert failed: unable to read inserted id for driver "${driver}".`)
}

function compileSQL(query: Knex.QueryBuilder, _label: string): CompiledSQL {
  const compiled = query.toSQL()
  const sql = typeof compiled.sql === 'string' ? compiled.sql : String(compiled.sql)
  const bindings = Array.isArray(compiled.bindings) ? (compiled.bindings as unknown[]) : []
  return { sql, bindings }
}
