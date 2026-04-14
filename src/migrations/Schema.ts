/**
 * Schema facade for `@atlex/orm` migrations.
 *
 * Provides a fluent static API (`Schema.create`, `Schema.table`, etc.).
 * that delegates to Knex's schema builder internally via a `Connection`.
 */

import type { Knex } from 'knex'

import { ConnectionRegistry } from '../ConnectionRegistry.js'

import { Blueprint } from './Blueprint.js'

export class Schema {
  private static connectionName: string | undefined

  /**
   * Use a named connection for subsequent schema calls.
   *
   * @param name - Connection name.
   * @returns this
   * @example
   * Schema.connection('default').create('users', ...)
   */
  public static connection(name: string): typeof Schema {
    Schema.connectionName = name
    return Schema
  }

  private static knex(): Knex {
    const conn = ConnectionRegistry.instance().connection(Schema.connectionName)
    return conn._knex()
  }

  /**
   * Create a table.
   */
  public static async create(table: string, callback: (table: Blueprint) => void): Promise<void> {
    const knex = Schema.knex()
    const blueprint = new Blueprint(table)
    callback(blueprint)
    await knex.schema.createTable(table, (t) => {
      blueprint.applyTo(t, knex)
    })
  }

  /**
   * Modify an existing table.
   */
  public static async table(table: string, callback: (table: Blueprint) => void): Promise<void> {
    const knex = Schema.knex()
    const blueprint = new Blueprint(table)
    callback(blueprint)
    await knex.schema.alterTable(table, (t) => {
      blueprint.applyTo(t, knex)
    })
  }

  /**
   * Drop a table.
   */
  public static async drop(table: string): Promise<void> {
    const knex = Schema.knex()
    await knex.schema.dropTable(table)
  }

  /**
   * Drop a table if it exists.
   */
  public static async dropIfExists(table: string): Promise<void> {
    const knex = Schema.knex()
    await knex.schema.dropTableIfExists(table)
  }

  /**
   * Rename a table.
   */
  public static async rename(from: string, to: string): Promise<void> {
    const knex = Schema.knex()
    await knex.schema.renameTable(from, to)
  }

  /**
   * Check if a table exists.
   */
  public static async hasTable(table: string): Promise<boolean> {
    const knex = Schema.knex()
    return await knex.schema.hasTable(table)
  }

  /**
   * Escape hatch to the underlying Knex schema builder.
   *
   * @returns Knex schema builder.
   */
  public static raw(): Knex.SchemaBuilder {
    const knex = Schema.knex()
    return knex.schema
  }
}
