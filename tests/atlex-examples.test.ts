import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ConnectionRegistry } from '../src/ConnectionRegistry.js'
import { db } from '../src/db.js'
import { Model } from '../src/Model.js'

class ExUser extends Model {
  static override table = 'ex_users'

  static override fillable = ['name']

  static override timestamps = false
}

describe('@atlex/orm examples', () => {
  beforeAll(async () => {
    ConnectionRegistry.resetForTests()
    ConnectionRegistry.instance().register('default', {
      driver: 'better-sqlite3',
      database: ':memory:',
      filename: ':memory:',
      pool: { min: 1, max: 1 },
    })
    const k = ConnectionRegistry.instance().default()._knex()
    await k.schema.createTable('ex_users', (t) => {
      t.increments('id')
      t.string('name', 64).notNullable()
    })
  })

  afterAll(async () => {
    const c = ConnectionRegistry.instance().default()
    await c.close()
    ConnectionRegistry.resetForTests()
  })

  it('db() selects empty', async () => {
    const rows = await db('ex_users').get()
    expect(rows).toHaveLength(0)
  })

  it('insert and count', async () => {
    await db('ex_users').insert({ name: 'A' })
    const n = await db('ex_users').count()
    expect(n).toBe(1)
  })

  it('Model.create', async () => {
    const u = await ExUser.create({ name: 'B' })
    expect(u.getAttribute('name')).toBe('B')
  })

  it('Model.query first', async () => {
    const u = await ExUser.query().where('name', 'A').first()
    expect(u).not.toBeNull()
  })

  it('truncate helper table', async () => {
    await db('ex_users').delete()
    expect(await db('ex_users').count()).toBe(0)
  })
})
