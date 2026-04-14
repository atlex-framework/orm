import { describe, expect, it } from 'vitest'

import { LengthAwarePaginator } from '../../src/pagination/LengthAwarePaginator.js'

describe('LengthAwarePaginator', () => {
  it('calculates lastPage correctly (50 items, 15 per page → 4)', () => {
    const p = new LengthAwarePaginator(
      Array.from({ length: 15 }, (_, i) => i),
      50,
      15,
      1,
    )
    expect(p.lastPage()).toBe(4)
  })

  it('returns correct from/to (page 2: from=16, to=30)', () => {
    const items = Array.from({ length: 15 }, (_, i) => i)
    const p = new LengthAwarePaginator(items, 50, 15, 2)
    expect(p.from()).toBe(16)
    expect(p.to()).toBe(30)
  })

  it('hasMorePages is false on last page', () => {
    const p = new LengthAwarePaginator([1, 2], 50, 15, 4)
    expect(p.hasMorePages()).toBe(false)
  })

  it('onFirstPage/onLastPage are correct', () => {
    const first = new LengthAwarePaginator([1], 50, 15, 1)
    expect(first.onFirstPage()).toBe(true)
    expect(first.onLastPage()).toBe(false)
    const last = new LengthAwarePaginator([1], 50, 15, 4)
    expect(last.onLastPage()).toBe(true)
  })

  it('generates correct URLs with query params', () => {
    const p = new LengthAwarePaginator([1], 30, 10, 2, {
      path: '/users',
      query: { foo: 'bar' },
    })
    expect(p.url(3)).toBe('/users?foo=bar&page=3')
  })

  it('serializes toJSON() with correct format', () => {
    const p = new LengthAwarePaginator([{ a: 1 }], 25, 10, 1, { path: '/x' })
    const j = p.toJSON()
    expect(j.meta.total).toBe(25)
    expect(j.meta.perPage).toBe(10)
    expect(j.data).toHaveLength(1)
    expect(j.links.first).toContain('page=1')
  })

  it('handles empty results (from=null, to=null)', () => {
    const p = new LengthAwarePaginator([], 0, 15, 1)
    expect(p.from()).toBeNull()
    expect(p.to()).toBeNull()
  })

  it('handles single page (total < perPage)', () => {
    const p = new LengthAwarePaginator([1, 2, 3], 3, 15, 1)
    expect(p.lastPage()).toBe(1)
    expect(p.hasMorePages()).toBe(false)
  })
})
