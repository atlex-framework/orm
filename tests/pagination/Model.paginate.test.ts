import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ConnectionRegistry } from '../../src/ConnectionRegistry.js'
import { InvalidCursorException } from '../../src/exceptions/InvalidCursorException.js'
import { Model } from '../../src/Model.js'

class PageItem extends Model {
  static override table = 'items'
}

describe('Model pagination', () => {
  beforeAll(async () => {
    ConnectionRegistry.resetForTests()
    ConnectionRegistry.instance().register('default', {
      driver: 'better-sqlite3',
      database: ':memory:',
      filename: ':memory:',
    })
    const knex = ConnectionRegistry.instance().default()._knex()
    await knex.schema.createTable('items', (t) => {
      t.increments('id').primary()
      t.integer('sort_order').notNullable()
    })
    for (let i = 1; i <= 25; i++) {
      await knex('items').insert({ sort_order: i })
    }
  })

  afterAll(async () => {
    await ConnectionRegistry.instance().default().close()
    ConnectionRegistry.resetForTests()
  })

  it('paginate uses primary key by default shape', async () => {
    const p = await PageItem.paginate(10, { page: 1, path: '/items' })
    expect(p.total()).toBe(25)
    expect(p.items()).toHaveLength(10)
  })

  it('cursorPaginate uses primary key when no orderBy', async () => {
    const p = await PageItem.cursorPaginate(5)
    expect(p.items()).toHaveLength(5)
    const enc = p.nextCursor()?.encode()
    expect(enc).toBeDefined()
  })

  it('cursorPaginate returns correct next page with cursor', async () => {
    const first = await PageItem.query().orderBy('sort_order', 'asc').cursorPaginate(5)
    const next = first.nextCursor()?.encode()
    expect(next).toBeDefined()
    const second = await PageItem.query()
      .orderBy('sort_order', 'asc')
      .cursorPaginate(5, { cursor: next })
    expect(second.items()).toHaveLength(5)
    expect(second.items()[0]?.getAttribute('sort_order')).toBe(6)
  })

  it('throws InvalidCursorException for bad cursor', async () => {
    await expect(
      PageItem.query().orderBy('id', 'asc').cursorPaginate(5, { cursor: 'not-valid' }),
    ).rejects.toThrow(InvalidCursorException)
  })
})
