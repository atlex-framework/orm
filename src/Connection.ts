/**
 * Database connection management for `@atlex/orm`.
 *
 * Wraps a single Knex instance and provides Atlex-friendly validation and
 * lifecycle helpers (ping/close). Knex is an internal implementation detail.
 */

import knex from 'knex'
import type { Knex } from 'knex'

export interface DatabaseConfig {
  driver: 'pg' | 'mysql2' | 'better-sqlite3'
  host?: string
  port?: number
  database: string // for SQLite: this is the file path
  username?: string
  password?: string
  /**
   * PostgreSQL only: primary schema for unqualified table names (often `DB_SCHEMA` in env).
   * Knex `search_path` is set to `[schema, "public"]` when set and not `"public"`, else `["public"]`.
   * Non-`public` schemas are created with `CREATE SCHEMA IF NOT EXISTS` on each new pool connection
   * (Postgres ignores missing names in `search_path`, which would otherwise send tables to `public`).
   */
  schema?: string
  filename?: string // alias for SQLite path
  pool?: {
    min?: number // default: 2
    max?: number // default: 10
    acquireTimeoutMillis?: number
  }
  /** When true, Knex prints every query. Prefer enabling via DB_DEBUG=true in .env rather than hard-coding. */
  debug?: boolean
}

type RequiredForNetworkDrivers = Pick<DatabaseConfig, 'host' | 'database'>

function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Database config error: "${name}" must be a non-empty string.`)
  }
}

function assertFinitePositiveInteger(value: unknown, name: string): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new Error(`Database config error: "${name}" must be a positive integer.`)
  }
}

function resolveSqliteFilename(config: DatabaseConfig): string {
  if (typeof config.filename === 'string' && config.filename.trim().length > 0) {
    return config.filename
  }
  return config.database
}

/** Knex `searchPath` for PostgreSQL from optional `schema` (e.g. `DB_SCHEMA`). */
function postgresSearchPath(schema?: string): string | readonly string[] {
  const s = schema?.trim()
  if (s === undefined || s.length === 0 || s === 'public') {
    return 'public'
  }
  return [s, 'public']
}

function escapePgIdentSegment(ident: string): string {
  return ident.replace(/"/g, '""')
}

/** `SET search_path` SQL matching Knex’s postgres dialect (quoted identifiers). */
function postgresSetSearchPathSql(schema?: string): string {
  const sp = postgresSearchPath(schema)
  const parts = (Array.isArray(sp) ? [...sp] : [sp]).map((seg) => `"${escapePgIdentSegment(seg)}"`)
  return `SET search_path TO ${parts.join(', ')}`
}

function postgresNeedsSchemaBootstrap(schema?: string): boolean {
  const s = schema?.trim()
  return s !== undefined && s.length > 0 && s !== 'public'
}

interface PgConn {
  query: (sql: string, cb: (err: Error | null) => void) => void
}

function validateConfig(config: DatabaseConfig): void {
  if (config.driver !== 'pg' && config.driver !== 'mysql2' && config.driver !== 'better-sqlite3') {
    // Exhaustiveness guard for future changes.
    throw new Error(`Database config error: unsupported driver "${String(config.driver)}".`)
  }

  assertNonEmptyString(config.database, 'database')

  if (config.driver === 'pg' || config.driver === 'mysql2') {
    const network: RequiredForNetworkDrivers = config
    assertNonEmptyString(network.host, 'host')
    if (config.port !== undefined) {
      assertFinitePositiveInteger(config.port, 'port')
    }
    if (config.username !== undefined) assertNonEmptyString(config.username, 'username')
    if (config.password !== undefined) assertNonEmptyString(config.password, 'password')
  }

  if (config.driver === 'better-sqlite3') {
    const filename = resolveSqliteFilename(config)
    assertNonEmptyString(filename, 'filename (or "database" for SQLite)')
  }

  if (config.driver === 'pg' && config.schema !== undefined) {
    const s = config.schema.trim()
    if (s.length > 0) assertNonEmptyString(s, 'schema')
  }

  if (config.pool?.min !== undefined) assertFinitePositiveInteger(config.pool.min, 'pool.min')
  if (config.pool?.max !== undefined) assertFinitePositiveInteger(config.pool.max, 'pool.max')
  if (config.pool?.acquireTimeoutMillis !== undefined) {
    assertFinitePositiveInteger(config.pool.acquireTimeoutMillis, 'pool.acquireTimeoutMillis')
  }
}

export class Connection {
  private static _default: Connection | null = null

  private readonly knexInstance: Knex
  private readonly driverName: DatabaseConfig['driver']

  private constructor(driver: DatabaseConfig['driver'], instance: Knex) {
    this.driverName = driver
    this.knexInstance = instance
  }

  /**
   * Resolve a new `Connection` from a `DatabaseConfig`.
   *
   * @param config - Database configuration.
   * @returns A new `Connection` instance.
   * @example
   * const conn = Connection.resolve({ driver: 'pg', host: 'localhost', database: 'app' })
   */
  public static resolve(config: DatabaseConfig): Connection {
    validateConfig(config)

    const pool: Knex.PoolConfig = {
      min: config.pool?.min ?? 2,
      max: config.pool?.max ?? 10,
      ...(config.pool?.acquireTimeoutMillis !== undefined
        ? { acquireTimeoutMillis: config.pool.acquireTimeoutMillis }
        : {}),
    }

    if (config.driver === 'better-sqlite3') {
      const filename = resolveSqliteFilename(config)
      const instance = knex({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: {
          filename,
        },
        pool,
        debug: config.debug ?? false,
      })
      return new Connection(config.driver, instance)
    }

    if (config.driver === 'pg') {
      const poolConfig: Knex.PoolConfig = { ...pool }
      if (postgresNeedsSchemaBootstrap(config.schema)) {
        const schemaName = config.schema!.trim()
        poolConfig.afterCreate = (
          conn: unknown,
          done: (err: Error | undefined, conn: unknown) => void,
        ) => {
          const c = conn as PgConn
          const createSql = `CREATE SCHEMA IF NOT EXISTS "${escapePgIdentSegment(schemaName)}"`
          c.query(createSql, (err1) => {
            if (err1) {
              done(err1, conn)
              return
            }
            c.query(postgresSetSearchPathSql(config.schema), (err2) => {
              done(err2 ?? undefined, conn)
            })
          })
        }
      }

      const pgConnection: Knex.PgConnectionConfig = {
        host: config.host!,
        database: config.database,
        ...(config.port !== undefined ? { port: config.port } : {}),
        ...(config.username !== undefined ? { user: config.username } : {}),
        ...(config.password !== undefined ? { password: config.password } : {}),
      }
      const instance = knex({
        client: 'pg',
        connection: pgConnection,
        searchPath: postgresSearchPath(config.schema),
        pool: poolConfig,
        debug: config.debug ?? false,
      })
      return new Connection(config.driver, instance)
    }

    // mysql2
    const mysqlConnection: Knex.MySql2ConnectionConfig = {
      host: config.host!,
      database: config.database,
      ...(config.port !== undefined ? { port: config.port } : {}),
      ...(config.username !== undefined ? { user: config.username } : {}),
      ...(config.password !== undefined ? { password: config.password } : {}),
    }
    const instance = knex({
      client: 'mysql2',
      connection: mysqlConnection,
      pool,
      debug: config.debug ?? false,
    })
    return new Connection(config.driver, instance)
  }

  /**
   * Get the currently set default connection.
   *
   * @returns The default `Connection`.
   * @example
   * const conn = Connection.default()
   */
  public static default(): Connection {
    if (Connection._default === null) {
      throw new Error(
        'No default database connection set. Register one via ConnectionRegistry.register(...) or call Connection.setDefault(...).',
      )
    }
    return Connection._default
  }

  /**
   * Set the default connection used by the ORM.
   *
   * @param conn - Connection to set as default.
   * @returns void
   * @example
   * Connection.setDefault(conn)
   */
  public static setDefault(conn: Connection): void {
    Connection._default = conn
  }

  /**
   * @internal Clears the default connection reference (Vitest / isolated integration tests only).
   */
  public static clearDefaultForTests(): void {
    Connection._default = null
  }

  /**
   * Escape hatch to access the underlying Knex instance.
   * This is intentionally typed as `unknown` to avoid leaking Knex types
   * into the public API surface.
   *
   * @returns The internal Knex instance.
   * @example
   * const knex = conn.getKnex() as any // not recommended; prefer QueryBuilder
   */
  public getKnex(): unknown {
    return this.knexInstance
  }

  /** @internal */
  public _knex(): Knex {
    return this.knexInstance
  }

  /**
   * Verify connectivity by executing a trivial query.
   *
   * @returns True if connectivity is working.
   * @example
   * await conn.ping()
   */
  public async ping(): Promise<boolean> {
    try {
      await this.knexInstance.raw('select 1')
      return true
    } catch {
      return false
    }
  }

  /**
   * Close/destroy the connection pool.
   *
   * @returns void
   * @example
   * await conn.close()
   */
  public async close(): Promise<void> {
    await this.knexInstance.destroy()
  }

  /**
   * Read-only driver identifier.
   *
   * @returns Driver string.
   * @example
   * console.log(conn.driver)
   */
  public get driver(): string {
    return this.driverName
  }
}
