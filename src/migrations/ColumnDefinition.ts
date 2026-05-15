/**
 * ColumnDefinition for `@atlex/orm` migrations.
 *
 * Provides a fluent chainable API (nullable, defaultTo, unique, index, unsigned, primary)
 * similar to common migration column modifiers.
 */

export interface ColumnModifier {
  kind: 'nullable' | 'default' | 'useCurrent' | 'unique' | 'index' | 'primary' | 'unsigned'
  value?: unknown
  name?: string
}

/** Marker returned by `Blueprint.raw()` for SQL default expressions. */
export interface RawSqlExpression {
  readonly __atlexRawSql: string
}

export function isRawSqlExpression(value: unknown): value is RawSqlExpression {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__atlexRawSql' in value &&
    typeof (value as RawSqlExpression).__atlexRawSql === 'string'
  )
}

export class ColumnDefinition {
  public readonly name: string
  public readonly type: string
  public readonly args: readonly unknown[]
  public readonly modifiers: ColumnModifier[] = []

  public constructor(name: string, type: string, args: readonly unknown[] = []) {
    this.name = name
    this.type = type
    this.args = args
  }

  /**
   * Mark the column nullable.
   *
   * @returns this
   * @example
   * table.string('email').nullable()
   */
  public nullable(): this {
    this.modifiers.push({ kind: 'nullable' })
    return this
  }

  /**
   * Knex-compatible alias; columns are NOT NULL unless `.nullable()` is called.
   */
  public notNullable(): this {
    return this
  }

  /**
   * Set a default value.
   *
   * @param value - Default value.
   * @returns this
   * @example
   * table.boolean('active').defaultTo(true)
   */
  public defaultTo(value: unknown): this {
    this.modifiers.push({ kind: 'default', value })
    return this
  }

  /**
   * Set the default to the database "now" (e.g. PostgreSQL `CURRENT_TIMESTAMP`).
   * Prefer this over `defaultTo(new Date())`, which can stringify with a locale
   * timezone label and break drivers such as PostgreSQL.
   *
   * @returns this
   */
  public useCurrent(): this {
    this.modifiers.push({ kind: 'useCurrent' })
    return this
  }

  /**
   * Create a unique index.
   *
   * @param name - Optional index name.
   * @returns this
   * @example
   * table.string('email').unique()
   */
  public unique(name?: string): this {
    if (name !== undefined) {
      this.modifiers.push({ kind: 'unique', name })
    } else {
      this.modifiers.push({ kind: 'unique' })
    }
    return this
  }

  /**
   * Create a non-unique index.
   *
   * @param name - Optional index name.
   * @returns this
   * @example
   * table.integer('user_id').index()
   */
  public index(name?: string): this {
    if (name !== undefined) {
      this.modifiers.push({ kind: 'index', name })
    } else {
      this.modifiers.push({ kind: 'index' })
    }
    return this
  }

  /**
   * Mark as primary key.
   *
   * @returns this
   * @example
   * table.bigIncrements('id').primary()
   */
  public primary(): this {
    this.modifiers.push({ kind: 'primary' })
    return this
  }

  /**
   * Mark the column unsigned (where supported).
   *
   * @returns this
   * @example
   * table.integer('age').unsigned()
   */
  public unsigned(): this {
    this.modifiers.push({ kind: 'unsigned' })
    return this
  }
}
