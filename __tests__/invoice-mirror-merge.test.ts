import { describe, expect, it } from 'vitest'
import { mergeInvoiceMirror } from '@/lib/invoice-mirror-merge'

describe('mergeInvoiceMirror', () => {
  it('keeps a store-only bill that is absent from the table', () => {
    const table = [{ id: 'a', ref: 'INV/1' }]
    const existing = [{ id: 'a', ref: 'INV/1', stale: true }, { id: 'b', ref: 'BILL/2026/0010' }]
    const { merged, kept } = mergeInvoiceMirror(table, existing)
    expect(kept).toBe(1)
    expect(merged).toEqual([{ id: 'a', ref: 'INV/1' }, { id: 'b', ref: 'BILL/2026/0010' }])
  })

  it('lets the table win for ids it contains', () => {
    const { merged } = mergeInvoiceMirror([{ id: 'a', amountPaid: 500, ref: 'new' }], [{ id: 'a', amountPaid: 0, ref: 'old' }])
    expect(merged).toEqual([{ id: 'a', amountPaid: 500, ref: 'new' }])
  })

  it('never lowers a recorded amountPaid that the table has not caught up with', () => {
    const { merged } = mergeInvoiceMirror([{ id: 'a', amountPaid: 0, ref: 'INV/1' }], [{ id: 'a', amountPaid: 4000 }])
    expect(merged).toEqual([{ id: 'a', amountPaid: 4000, ref: 'INV/1' }])
  })

  it('handles a missing or malformed existing list', () => {
    expect(mergeInvoiceMirror([{ id: 'a' }], undefined).merged).toEqual([{ id: 'a' }])
    expect(mergeInvoiceMirror([{ id: 'a' }], 'oops').kept).toBe(0)
    expect(mergeInvoiceMirror([], [null, { noId: true }, 7]).merged).toEqual([])
  })
})
