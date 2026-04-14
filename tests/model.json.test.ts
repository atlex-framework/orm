import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ConnectionRegistry } from '../src/ConnectionRegistry.js'
import { Model } from '../src/Model.js'

class JsonUser extends Model {
  static override table = 'users'
  static override fillable = ['name', 'email']
}

describe('Model JSON serialization', () => {
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
      t.string('name', 255).notNullable()
      t.string('email', 255).notNullable()
    })
    await knex('users').insert({ name: 'Ada', email: 'ada@example.test' })
  })

  afterAll(async () => {
    await ConnectionRegistry.instance().default().close()
    ConnectionRegistry.resetForTests()
  })

  it('JSON.stringify includes row attributes for hydrated models', async () => {
    const users = await JsonUser.all()
    expect(users).toHaveLength(1)
    const raw = JSON.stringify(users)
    expect(raw).toContain('Ada')
    expect(raw).toContain('ada@example.test')
  })

  it('toJSON returns plain attributes', async () => {
    const user = await JsonUser.query().first()
    expect(user).not.toBeNull()
    const o = user!.toJSON()
    expect(o.name).toBe('Ada')
    expect(o.email).toBe('ada@example.test')
  })
})
