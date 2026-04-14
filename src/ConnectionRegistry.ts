/**
 * Named connection registry for `@atlex/orm`.
 *
 * Stores configured connections and provides access to named/default instances.
 */

import type { Knex } from 'knex'

import { Connection, type DatabaseConfig } from './Connection.js'

export class ConnectionRegistry {
  private static singleton: ConnectionRegistry | null = null

  private readonly connections = new Map<string, Connection>()
  private defaultName: string | null = null

  /** @internal Active outer transaction for test isolation (see `@atlex/testing` `useDatabase`). */
  private testTransaction: Knex.Transaction | null = null

  private constructor() {}

  /**
   * Get the singleton registry instance.
   *
   * @returns The `ConnectionRegistry` singleton.
   * @example
   * const registry = ConnectionRegistry.instance()
   */
  public static instance(): ConnectionRegistry {
    if (ConnectionRegistry.singleton === null) {
      ConnectionRegistry.singleton = new ConnectionRegistry()
    }
    return ConnectionRegistry.singleton
  }

  /**
   * Register a named connection from a config.
   *
   * @param name - Connection name.
   * @param config - Database configuration for the connection.
   * @returns void
   * @example
   * ConnectionRegistry.instance().register('default', { driver: 'pg', host: 'localhost', database: 'app' })
   */
  public register(name: string, config: DatabaseConfig): void {
    const conn = Connection.resolve(config)
    this.extend(name, conn)
  }

  /**
   * Register a pre-built `Connection` instance under a name.
   *
   * @param name - Connection name.
   * @param conn - Pre-built connection.
   * @returns void
   * @example
   * ConnectionRegistry.instance().extend('analytics', conn)
   */
  public extend(name: string, conn: Connection): void {
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      throw new Error('Connection registry error: "name" must be a non-empty string.')
    }
    this.connections.set(trimmed, conn)

    if (this.defaultName === null) {
      this.defaultName = trimmed
      Connection.setDefault(conn)
    }
  }

  /**
   * Get a connection by name, or return the default connection when no name is provided.
   *
   * @param name - Optional connection name.
   * @returns A `Connection` instance.
   * @example
   * const conn = ConnectionRegistry.instance().connection()
   */
  public connection(name?: string): Connection {
    if (name === undefined) {
      if (this.defaultName !== null) {
        const conn = this.connections.get(this.defaultName)
        if (conn !== undefined) return conn
      }
      return Connection.default()
    }

    const trimmed = name.trim()
    const conn = this.connections.get(trimmed)
    if (conn === undefined) {
      const known = Array.from(this.connections.keys())
      const hint = known.length > 0 ? ` Known connections: ${known.join(', ')}.` : ''
      throw new Error(`Database connection "${trimmed}" is not registered.${hint}`)
    }
    return conn
  }

  /**
   * Get the default connection (alias for `connection()`).
   *
   * @returns Default `Connection`.
   * @example
   * const conn = ConnectionRegistry.instance().default()
   */
  public default(): Connection {
    return this.connection()
  }

  /**
   * @internal Binds an open Knex transaction so new {@link import("./db.js").db} builders run queries on it.
   *
   * @param trx - Open transaction (do not commit; roll back in test teardown).
   */
  public bindTestTransaction(trx: Knex.Transaction): void {
    this.testTransaction = trx
  }

  /**
   * @internal Clears the transaction bound by {@link bindTestTransaction}.
   */
  public unbindTestTransaction(): void {
    this.testTransaction = null
  }

  /**
   * @internal Returns the transaction from {@link bindTestTransaction}, if any.
   */
  public activeTestTransaction(): Knex.Transaction | null {
    return this.testTransaction
  }

  /**
   * @internal Resets the registry singleton and default connection (Vitest only).
   */
  public static resetForTests(): void {
    ConnectionRegistry.singleton = null
    Connection.clearDefaultForTests()
  }
}
