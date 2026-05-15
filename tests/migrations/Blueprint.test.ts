import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Knex } from 'knex'

import { ConnectionRegistry } from '../../src/ConnectionRegistry.js'
import { Blueprint } from '../../src/migrations/Blueprint.js'
import { ColumnDefinition, isRawSqlExpression } from '../../src/migrations/ColumnDefinition.js'
import { Schema } from '../../src/migrations/Schema.js'

type SqliteColumnRow = {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

async function getSqliteColumns(
  knex: Knex,
  table: string,
): Promise<Record<string, SqliteColumnRow>> {
  const rows = (await knex.raw(`PRAGMA table_info(??)`, [table])) as SqliteColumnRow[]
  return Object.fromEntries(rows.map((row) => [row.name, row]))
}

describe('ColumnDefinition helpers', () => {
  it('isRawSqlExpression identifies Blueprint.raw() values', () => {
    const blueprint = new Blueprint('t')
    const raw = blueprint.raw('gen_random_uuid()')
    expect(isRawSqlExpression(raw)).toBe(true)
    expect(isRawSqlExpression({ __atlexRawSql: 'now()' })).toBe(true)
    expect(isRawSqlExpression('gen_random_uuid()')).toBe(false)
    expect(isRawSqlExpression(null)).toBe(false)
  })

  it('notNullable() is a no-op chain alias', () => {
    const col = new ColumnDefinition('email', 'string')
    const chained = col.notNullable().defaultTo('x')
    expect(chained).toBe(col)
    expect(col.modifiers).toEqual([{ kind: 'default', value: 'x' }])
  })
})

describe('Blueprint operation collection', () => {
  it('records uuid, enum, and table-level unique operations', () => {
    const blueprint = new Blueprint('users')
    blueprint.uuid('id').primary()
    blueprint.enum('role', ['parent', 'child'])
    blueprint.unique('email', 'users_email_unique')

    const ops = blueprint.getOperations()
    const columns = ops.filter((op) => op.kind === 'column').map((op) => op.column)
    expect(columns.map((c) => [c.name, c.type])).toEqual([
      ['id', 'uuid'],
      ['role', 'enum'],
    ])
    expect(columns[1]?.args[0]).toEqual(['parent', 'child'])

    const uniques = ops.filter((op) => op.kind === 'tableUnique')
    expect(uniques).toHaveLength(1)
    expect(uniques[0]).toMatchObject({
      kind: 'tableUnique',
      columns: ['email'],
      name: 'users_email_unique',
    })
  })

  it('rejects unique() with no columns', () => {
    const blueprint = new Blueprint('users')
    expect(() => blueprint.unique([])).toThrow(/unique\(\) requires at least one column/)
  })
})

describe('Blueprint migrations (sqlite)', () => {
  let knex: Knex

  beforeAll(async () => {
    ConnectionRegistry.resetForTests()
    ConnectionRegistry.instance().register('default', {
      driver: 'better-sqlite3',
      database: ':memory:',
      filename: ':memory:',
      pool: { min: 1, max: 1 },
    })
    knex = ConnectionRegistry.instance().default()._knex()
  })

  afterAll(async () => {
    const conn = ConnectionRegistry.instance().default()
    await conn.close()
    ConnectionRegistry.resetForTests()
  })

  it('creates uuid, enum, nullable, and table-unique columns', async () => {
    await Schema.create('bp_users', (table) => {
      table.uuid('id').primary()
      table.string('email').unique()
      table.enum('role', ['parent', 'child']).defaultTo('parent')
      table.string('google_sub').nullable().unique()
    })

    const columns = await getSqliteColumns(knex, 'bp_users')
    expect(columns).toHaveProperty('id')
    expect(columns).toHaveProperty('email')
    expect(columns).toHaveProperty('role')
    expect(columns).toHaveProperty('google_sub')

    expect(columns['email']?.notnull).toBe(1)
    expect(columns['google_sub']?.notnull).toBe(0)
    expect(columns['role']?.dflt_value).toBe("'parent'")

    await knex('bp_users').insert({
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      email: 'a@test.com',
    })
    await expect(
      knex('bp_users').insert({ id: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee', email: 'a@test.com' }),
    ).rejects.toThrow()
  })

  it('applies raw SQL defaults via defaultTo(table.raw(...))', async () => {
    await Schema.create('bp_raw_default', (table) => {
      table.string('status').defaultTo(table.raw("'active'"))
    })

    const columns = await getSqliteColumns(knex, 'bp_raw_default')
    expect(columns['status']?.dflt_value).toBe("'active'")

    await knex('bp_raw_default').insert({})
    const row = await knex('bp_raw_default').first()
    expect(row?.status).toBe('active')
  })

  it('enforces table.unique() on a column', async () => {
    await Schema.create('bp_parents', (table) => {
      table.uuid('id').primary()
      table.uuid('user_id').notNullable()
      table.unique('user_id')
    })

    const userId = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
    await knex('bp_parents').insert({ id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', user_id: userId })
    await expect(
      knex('bp_parents').insert({ id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', user_id: userId }),
    ).rejects.toThrow()
  })

  it('supports native enum options when provided', async () => {
    const blueprint = new Blueprint('enum_opts')
    blueprint.enum('status', ['open', 'closed'], { useNative: true, enumName: 'status_enum' })
    const col = blueprint.getOperations().find((op) => op.kind === 'column')?.column
    expect(col?.args[1]).toEqual({ useNative: true, enumName: 'status_enum' })
  })
})
