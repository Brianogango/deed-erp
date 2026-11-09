import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('server-only', () => ({}))
import { applyRowDelta, buildManifest, diffRows } from '@/lib/store-row-delta'
import { clearRowManifests, rowDeltaFor } from '@/lib/store-row-delta.server'

const h = (r: Record<string, unknown>) => JSON.stringify(r)
const list = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, total: i, lines: [{ q: 1 }] }))

describe('changed rows only', () => {
  it('sends changed rows, removals and the order only when needed', () => {
    const before = list(5)
    const after = [{ id: 'new', total: 9 }, ...before.filter(r => r.id !== 'r2').map(r => (r.id === 'r3' ? { ...r, total: 33 } : r))]
    const d = diffRows(buildManifest(before, h)!, after, buildManifest(after, h)!)
    expect(d.upsert.map(r => r.id)).toEqual(['new', 'r3'])
    expect(d.remove).toEqual(['r2'])
    expect(d.order).toEqual(['new', 'r0', 'r1', 'r3', 'r4'])
    expect(applyRowDelta(JSON.stringify(before), d)).toEqual(after)
  })

  it('an edit in place needs no order, and patches the copy', () => {
    const before = list(4)
    const after = before.map(r => (r.id === 'r1' ? { ...r, total: 100 } : r))
    const d = diffRows(buildManifest(before, h)!, after, buildManifest(after, h)!)
    expect(d.order).toBeUndefined()
    expect(applyRowDelta(before, d)).toEqual(after)
  })

  it('refuses a patch that does not fit, so the list is downloaded whole', () => {
    const before = list(4)
    expect(applyRowDelta(before.slice(1), { upsert: [], remove: [], count: 4 })).toBeNull()       // copy is short
    expect(applyRowDelta(before, { upsert: [{ id: 'x' }], remove: [], count: 5 })).toBeNull()      // new row without order
    expect(applyRowDelta(before, { upsert: [], remove: [], order: ['r0', 'zz'], count: 2 })).toBeNull() // unknown id
    expect(applyRowDelta('not json', { upsert: [], remove: [], count: 0 })).toBeNull()
    expect(buildManifest([{ id: 'a' }, { id: 'a' }], h)).toBeNull()                                // duplicate ids
  })

  describe('server', () => {
    beforeEach(() => clearRowManifests())
    it('answers with a delta for a version it served, whole otherwise', () => {
      const v1 = list(300)
      expect(rowDeltaFor('deed_invoices', v1, 'v1#me', undefined)).toBeNull() // first load: whole
      const v2 = v1.map(r => (r.id === 'r7' ? { ...r, total: -1 } : r))
      const d = rowDeltaFor('deed_invoices', v2, 'v2#me', 'v1#me')!
      expect(d.upsert).toEqual([{ id: 'r7', total: -1, lines: [{ q: 1 }] }])
      expect(applyRowDelta(v1, d)).toEqual(v2)
      expect(rowDeltaFor('deed_invoices', v2, 'v3#me', 'v0#other')).toBeNull() // unknown version
      expect(rowDeltaFor('deed_invoices', list(10), 'v4#me', 'v3#me')).toBeNull() // short list: whole
      const many = v2.map(r => ({ ...r, total: 5 }))
      expect(rowDeltaFor('deed_invoices', many, 'v5#me', 'v2#me')).toBeNull() // big change: whole
    })
  })
})
