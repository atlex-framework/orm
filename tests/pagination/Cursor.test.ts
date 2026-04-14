import { describe, expect, it } from 'vitest'

import { Cursor } from '../../src/pagination/Cursor.js'
import { InvalidCursorException } from '../../src/exceptions/InvalidCursorException.js'

describe('Cursor', () => {
  it('encodes/decodes round-trip', () => {
    const c = new Cursor({ id: 5, created_at: '2024-01-01' }, true)
    const d = Cursor.decode(c.encode())
    expect(d.parametersMap()).toEqual({ id: 5, created_at: '2024-01-01' })
    expect(d.pointsToNextItems()).toBe(true)
  })

  it('throws InvalidCursorException on garbage', () => {
    expect(() => Cursor.decode('@@@')).toThrow(InvalidCursorException)
  })

  it('fromItem extracts ordered columns', () => {
    const c = Cursor.fromItem({ id: 9, name: 'x' }, ['name', 'id'], false)
    expect(c.parameter('name')).toBe('x')
    expect(c.parameter('id')).toBe(9)
    expect(c.pointsToPreviousItems()).toBe(true)
  })
})
