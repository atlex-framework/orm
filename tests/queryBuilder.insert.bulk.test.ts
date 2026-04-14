import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ConnectionRegistry } from '../src/ConnectionRegistry.js'
import { QueryBuilder } from '../src/QueryBuilder.js'

describe('QueryBuilder.insert (bulk)', () => {
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
    })
  })

  afterAll(async () => {
    await ConnectionRegistry.instance().default().close()
    ConnectionRegistry.resetForTests()
  })

  it('does not call knex() with a nullable table reference', async () => {
    const qb = new QueryBuilder(ConnectionRegistry.instance().default()).table('users')
    const inserted = await qb.insert([{ email: 'a@example.test' }, { email: 'b@example.test' }])
    expect(inserted).toBe(2)
  })
})
