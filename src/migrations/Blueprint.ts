/**
 * Blueprint for `@atlex/orm` migrations.
 *
 * Collects a table's schema operations (create, alter, drop) and translates them
 * into Knex schema builder calls internally.
 */

import type { Knex } from 'knex'

import { ColumnDefinition } from './ColumnDefinition.js'

type ForeignKeyAction = 'restrict' | 'cascade' | 'set null' | 'no action'

class ForeignKeyDefinition {
  private referencesColumn: string | null = null
  private onTable: string | null = null
  private onDeleteAction: ForeignKeyAction | null = null
  private onUpdateAction: ForeignKeyAction | null = null

  public constructor(private readonly column: string) {}

  public references(column: string): this {
    this.referencesColumn = column
    return this
  }

  public on(table: string): this {
    this.onTable = table
    return this
  }

  public onDelete(action: ForeignKeyAction): this {
    this.onDeleteAction = action
    return this
  }

  public onUpdate(action: ForeignKeyAction): this {
    this.onUpdateAction = action
    return this
  }

  /** @internal */
  public apply(table: Knex.CreateTableBuilder | Knex.AlterTableBuilder): void {
    if (!this.referencesColumn || !this.onTable) {
      throw new Error(
        `Migration error: foreign key on "${this.column}" is incomplete. Call .references('...').on('...')`,
      )
    }
    const fk = table.foreign(this.column).references(this.referencesColumn).inTable(this.onTable)
    if (this.onDeleteAction) fk.onDelete(this.onDeleteAction)
    if (this.onUpdateAction) fk.onUpdate(this.onUpdateAction)
  }
}

type Operation =
  | { kind: 'column'; column: ColumnDefinition }
  | { kind: 'foreign'; fk: ForeignKeyDefinition }
  | { kind: 'tableIndex'; columns: string[]; name?: string }
  | { kind: 'dropColumn'; name: string }
  | { kind: 'drop'; ifExists: boolean }
  | { kind: 'rename'; to: string }

export class Blueprint {
  private readonly ops: Operation[] = []

  public constructor(public readonly tableName: string) {}

  /**
   * Shortcut for `bigIncrements('id').primary()`.
   */
  public id(): ColumnDefinition {
    return this.bigIncrements('id').primary()
  }

  /**
   * Add `created_at` and `updated_at` timestamps with DB-native "now" defaults
   * (via Knex), not JavaScript `Date` literals (which break PostgreSQL defaults).
   */
  public timestamps(): void {
    this.timestamp('created_at').useCurrent()
    this.timestamp('updated_at').useCurrent()
  }

  /**
   * Add a nullable `deleted_at` timestamp.
   */
  public softDeletes(): void {
    this.timestamp('deleted_at').nullable()
  }

  /**
   * Add a nullable remember token (VARCHAR(100)).
   */
  public rememberToken(): ColumnDefinition {
    return this.string('remember_token', 100).nullable()
  }

  // Column types
  public string(name: string, length = 255): ColumnDefinition {
    return this.addColumn(new ColumnDefinition(name, 'string', [length]))
  }

  public text(name: string): ColumnDefinition {
    return this.addColumn(new ColumnDefinition(name, 'text'))
  }

  public integer(name: string): ColumnDefinition {
    return this.addColumn(new ColumnDefinition(name, 'integer'))
  }

  public bigInteger(name: string): ColumnDefinition {
    return this.addColumn(new ColumnDefinition(name, 'bigInteger'))
  }

  public boolean(name: string): ColumnDefinition {
    return this.addColumn(new ColumnDefinition(name, 'boolean'))
  }

  public decimal(name: string, precision = 8, scale = 2): ColumnDefinition {
    return this.addColumn(new ColumnDefinition(name, 'decimal', [precision, scale]))
  }

  public timestamp(name: string): ColumnDefinition {
    return this.addColumn(new ColumnDefinition(name, 'timestamp'))
  }

  public dateTime(name: string): ColumnDefinition {
    return this.addColumn(new ColumnDefinition(name, 'dateTime'))
  }

  public increments(name: string): ColumnDefinition {
    return this.addColumn(new ColumnDefinition(name, 'increments'))
  }

  public bigIncrements(name: string): ColumnDefinition {
    return this.addColumn(new ColumnDefinition(name, 'bigIncrements'))
  }

  // Index helpers
  /**
   * Add an index on one or more columns (`table.index('email')` or `table.index(['a','b'])`).
   *
   * @param columns - Column name(s) to index.
   * @param name - Optional index name; omitted names are chosen by the driver/Knex.
   */
  public index(columns: string | string[], name?: string): void {
    const cols = typeof columns === 'string' ? [columns] : columns
    if (cols.length === 0) {
      throw new Error('Migration error: index() requires at least one column name.')
    }
    if (name !== undefined && name.length > 0) {
      this.ops.push({ kind: 'tableIndex', columns: cols, name })
    } else {
      this.ops.push({ kind: 'tableIndex', columns: cols })
    }
  }

  public foreign(column: string): ForeignKeyDefinition {
    const fk = new ForeignKeyDefinition(column)
    this.ops.push({ kind: 'foreign', fk })
    return fk
  }

  public dropColumn(name: string): void {
    this.ops.push({ kind: 'dropColumn', name })
  }

  /** @internal */
  public _drop(ifExists: boolean): void {
    this.ops.push({ kind: 'drop', ifExists })
  }

  /** @internal */
  public _rename(to: string): void {
    this.ops.push({ kind: 'rename', to })
  }

  /**
   * Escape hatch to access the underlying Knex table builder.
   *
   * @returns Internal operations list (intended for framework internals).
   */
  public getOperations(): readonly Operation[] {
    return this.ops
  }

  private addColumn(col: ColumnDefinition): ColumnDefinition {
    this.ops.push({ kind: 'column', column: col })
    return col
  }

  /** @internal */
  public applyTo(table: Knex.CreateTableBuilder | Knex.AlterTableBuilder, knex: Knex): void {
    for (const op of this.ops) {
      if (op.kind === 'column') {
        const def = op.column
        const col = buildKnexColumn(table, def, knex)
        applyModifiers(col, def, knex)
        continue
      }
      if (op.kind === 'foreign') {
        op.fk.apply(table)
        continue
      }
      if (op.kind === 'tableIndex') {
        const t = table as Knex.CreateTableBuilder
        if (op.name !== undefined && op.name.length > 0) {
          t.index(op.columns, op.name)
        } else {
          t.index(op.columns)
        }
        continue
      }
      if (op.kind === 'dropColumn') {
        table.dropColumn(op.name)
        continue
      }
      // drop/rename handled by Schema facade
    }
  }
}

function buildKnexColumn(
  table: Knex.CreateTableBuilder | Knex.AlterTableBuilder,
  def: ColumnDefinition,
  _knex: Knex,
): Knex.ColumnBuilder {
  switch (def.type) {
    case 'string':
      return table.string(def.name, def.args[0] as number)
    case 'text':
      return table.text(def.name)
    case 'integer':
      return table.integer(def.name)
    case 'bigInteger':
      return table.bigInteger(def.name)
    case 'boolean':
      return table.boolean(def.name)
    case 'decimal':
      return table.decimal(def.name, def.args[0] as number, def.args[1] as number)
    case 'timestamp':
      return table.timestamp(def.name, { useTz: false })
    case 'dateTime':
      return table.dateTime(def.name)
    case 'increments':
      return table.increments(def.name)
    case 'bigIncrements':
      return table.bigIncrements(def.name)
    default:
      throw new Error(
        `Migration error: unsupported column type "${def.type}" for column "${def.name}".`,
      )
  }
}

function applyModifiers(col: Knex.ColumnBuilder, def: ColumnDefinition, knex: Knex): void {
  for (const m of def.modifiers) {
    if (m.kind === 'nullable') col.nullable()
    else if (m.kind === 'unsigned') (col as unknown as { unsigned: () => void }).unsigned?.()
    else if (m.kind === 'useCurrent') col.defaultTo(knex.fn.now())
    else if (m.kind === 'default') {
      if (m.value instanceof Date) {
        col.defaultTo(knex.fn.now())
      } else {
        col.defaultTo(m.value as never)
      }
    } else if (m.kind === 'primary') col.primary()
    else if (m.kind === 'unique') col.unique(m.name)
    else if (m.kind === 'index') col.index(m.name)
  }
}
