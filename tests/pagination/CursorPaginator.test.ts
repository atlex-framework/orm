import { describe, expect, it } from 'vitest'

import { Cursor } from '../../src/pagination/Cursor.js'
import { CursorPaginator } from '../../src/pagination/CursorPaginator.js'

describe('CursorPaginator', () => {
  it('returns null nextCursor on last page', () => {
    const p = new CursorPaginator([{ id: 1 }], 10, null, null, false, { path: '/c' })
    expect(p.nextCursor()).toBeNull()
    expect(p.toJSON().meta.nextCursor).toBeNull()
  })

  it('returns null previousCursor on first page', () => {
    const next = Cursor.fromItem({ id: 2 }, ['id'], true)
    const p = new CursorPaginator([{ id: 1 }], 10, next, null, true, { path: '/c' })
    expect(p.previousCursor()).toBeNull()
  })

  it('exposes encoded cursors in meta', () => {
    const next = Cursor.fromItem({ id: 10 }, ['id'], true)
    const prev = Cursor.fromItem({ id: 5 }, ['id'], false)
    const p = new CursorPaginator([{ id: 7 }], 5, next, prev, true, { path: '/x' })
    const j = p.toJSON()
    expect(j.meta.nextCursor).toBe(next.encode())
    expect(j.meta.previousCursor).toBe(prev.encode())
  })
})
