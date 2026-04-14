import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ConnectionRegistry } from '../../src/ConnectionRegistry.js'
import { QueryBuilder } from '../../src/QueryBuilder.js'

describe('QueryBuilder.paginate()', () => {
  beforeAll(async () => {
    ConnectionRegistry.resetForTests()
    ConnectionRegistry.instance().register('default', {
      driver: 'better-sqlite3',
      database: ':memory:',
      filename: ':memory:',
    })
    const knex = ConnectionRegistry.instance().default()._knex()
    await knex.schema.createTable('users', (t) => {
      t.increments('id').primary()
      t.string('email', 255).notNullable()
      t.boolean('active').notNullable().defaultTo(1)
    })
    await knex.schema.createTable('posts', (t) => {
      t.increments('id').primary()
      t.integer('user_id').unsigned().notNullable()
    })
    for (let i = 0; i < 30; i++) {
      await knex('users').insert({ email: `u${i}@t.test`, active: i % 2 === 0 ? 1 : 0 })
    }
    await knex('posts').insert([{ user_id: 1 }, { user_id: 1 }, { user_id: 2 }])
  })

  afterAll(async () => {
    await ConnectionRegistry.instance().default().close()
    ConnectionRegistry.resetForTests()
  })

  it('returns LengthAwarePaginator with correct data', async () => {
    const conn = ConnectionRegistry.instance().default()
    const p = await new QueryBuilder(conn).table('users').paginate(10, { page: 1, path: '/u' })
    expect(p.total()).toBe(30)
    expect(p.items()).toHaveLength(10)
    expect(p.currentPage()).toBe(1)
  })

  it('respects where clauses in both count and data queries', async () => {
    const conn = ConnectionRegistry.instance().default()
    const p = await new QueryBuilder(conn)
      .table('users')
      .where('active', '=', 1)
      .paginate(100, { page: 1 })
    expect(p.total()).toBe(15)
    expect(p.items()).toHaveLength(15)
  })

  it('works with joins', async () => {
    const conn = ConnectionRegistry.instance().default()
    const p = await new QueryBuilder(conn)
      .table('users')
      .join('posts', 'posts.user_id', '=', 'users.id')
      .paginate(50, { page: 1 })
    expect(p.total()).toBeGreaterThanOrEqual(3)
  })

  it('runs simplePaginate without requiring count', async () => {
    const conn = ConnectionRegistry.instance().default()
    const p = await new QueryBuilder(conn).table('users').simplePaginate(5, { page: 2 })
    expect(p.items()).toHaveLength(5)
    expect(p.currentPage()).toBe(2)
  })
})
