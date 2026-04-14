import { describe, expect, it } from 'vitest'

import { Paginator } from '../../src/pagination/Paginator.js'

describe('Paginator (simple)', () => {
  it('detects more pages when probe row exists', () => {
    const p = new Paginator([1, 2, 3], 3, 1, true, { path: '/p' })
    expect(p.hasMorePages()).toBe(true)
    expect(p.count()).toBe(3)
  })

  it('toJSON includes hasMorePages and path', () => {
    const p = new Paginator([], 10, 2, false, { path: '/items' })
    const j = p.toJSON()
    expect(j.meta.hasMorePages).toBe(false)
    expect(j.meta.path).toBe('/items')
  })
})
