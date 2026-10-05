import { describe, it, expect } from 'vitest'
import { keepUnchangedRows, sameContent } from '@/lib/same-content'

describe('sameContent', () => {
  it('ignores key order and undefined fields', () => {
    expect(sameContent({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1, e: undefined })).toBe(true)
    expect(sameContent({ a: 1 }, { a: 2 })).toBe(false)
    expect(sameContent([1, 2], [2, 1])).toBe(false)
    expect(sameContent({ a: null }, { a: undefined })).toBe(false)
  })
})

describe('keepUnchangedRows', () => {
  const prev = [{ id: 'a', name: 'X', qty: 1 }, { id: 'b', name: 'Y', qty: 2 }]
  it('returns the previous array when only key order changed', () => {
    expect(keepUnchangedRows(prev, [{ qty: 1, name: 'X', id: 'a' }, { name: 'Y', id: 'b', qty: 2 }])).toBe(prev)
  })
  it('keeps unchanged rows and takes changed ones', () => {
    const next = keepUnchangedRows(prev, [{ id: 'a', name: 'X', qty: 1 }, { id: 'b', name: 'Y', qty: 5 }])
    expect(next).not.toBe(prev)
    expect(next[0]).toBe(prev[0])
    expect(next[1]).toEqual({ id: 'b', name: 'Y', qty: 5 })
  })
  it('notices added, removed and reordered rows', () => {
    expect(keepUnchangedRows(prev, [prev[0]])).not.toBe(prev)
    expect(keepUnchangedRows(prev, [prev[1], prev[0]])).not.toBe(prev)
  })
})
