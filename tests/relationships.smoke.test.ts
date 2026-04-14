import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ConnectionRegistry } from '../src/ConnectionRegistry.js'
import { Model } from '../src/Model.js'

/**
 * Smoke test for `hasMany` — run with: `pnpm exec vitest run packages/orm/tests` from the `atlex/` repo root.
 */
class Post extends Model {
  static override table = 'posts'
}

class User extends Model {
  static override table = 'users'

  public posts() {
    return this.hasMany(Post, 'user_id')
  }
}

describe('Model relationships (smoke)', () => {
  beforeAll(async () => {
    ConnectionRegistry.resetForTests()
    ConnectionRegistry.instance().register('default', {
      driver: 'better-sqlite3',
      database: ':memory:',
      filename: ':memory:',
    })
    const conn = ConnectionRegistry.instance().default()
    const knex = conn._knex()
    await knex.schema.createTable('users', (t) => {
      t.increments('id').primary()
    })
    await knex.schema.createTable('posts', (t) => {
      t.increments('id').primary()
      t.integer('user_id').notNullable()
      t.string('title', 255).notNullable()
    })
    await knex('users').insert({})
    await knex('posts').insert({ user_id: 1, title: 'hello' })
  })

  afterAll(async () => {
    const conn = ConnectionRegistry.instance().default()
    await conn.close()
    ConnectionRegistry.resetForTests()
  })

  it('hasMany loads related rows', async () => {
    const user = await User.query().where('id', 1).first()
    expect(user).not.toBeNull()
    const posts = await user!.posts().get()
    expect(posts).toHaveLength(1)
    expect(posts[0]!.getAttribute('title')).toBe('hello')
  })
})
