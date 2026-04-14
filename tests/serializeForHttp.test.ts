import { describe, expect, it } from 'vitest'

import { Model } from '../src/Model.js'
import { serializeForHttp } from '../src/serializeForHttp.js'

class Mini extends Model {
  static override table = 'minis'
}

describe('serializeForHttp', () => {
  it('maps models via toJSON', () => {
    const m = Mini.hydrate({ id: 1, name: 'x' })
    const out = serializeForHttp(m) as Record<string, unknown>
    expect(out.name).toBe('x')
  })

  it('maps arrays and nested objects', () => {
    const m = Mini.hydrate({ id: 2, name: 'y' })
    const out = serializeForHttp({ users: [m], meta: { ok: true } }) as Record<string, unknown>
    const users = out.users as Record<string, unknown>[]
    expect(users[0]!.name).toBe('y')
    expect(out.meta).toEqual({ ok: true })
  })
})
