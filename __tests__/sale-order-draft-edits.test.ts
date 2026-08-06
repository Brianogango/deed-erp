import { describe, it, expect, beforeEach } from 'vitest'
import {
  markSaleOrderDraftEdit,
  clearSaleOrderDraftEdit,
  hasSaleOrderDraftEdits,
  mergeSaleOrdersPreservingDraftEdits,
} from '@/lib/sale-order-draft-edits'

describe('mergeSaleOrdersPreservingDraftEdits', () => {
  beforeEach(() => {
    clearSaleOrderDraftEdit('so-1')
    clearSaleOrderDraftEdit('so-2')
  })

  it('returns remote when no draft edits are pending', () => {
    const local = [{ id: 'so-1', lines: [{ id: 'a' }] }]
    const remote = [{ id: 'so-1', lines: [{ id: 'a' }, { id: 'b' }] }]
    expect(mergeSaleOrdersPreservingDraftEdits(local, remote)).toEqual(remote)
  })

  it('keeps local lines for a draft-edited order when remote still has deleted products', () => {
    markSaleOrderDraftEdit('so-1')
    const local = [{ id: 'so-1', lines: [{ id: 'a' }] }, { id: 'so-2', lines: [] }]
    const remote = [
      { id: 'so-1', lines: [{ id: 'a' }, { id: 'b' }] },
      { id: 'so-2', lines: [{ id: 'x' }] },
    ]
    const merged = mergeSaleOrdersPreservingDraftEdits(local, remote)
    expect(merged.find(s => s.id === 'so-1')?.lines).toEqual([{ id: 'a' }])
    expect(merged.find(s => s.id === 'so-2')?.lines).toEqual([{ id: 'x' }])
    expect(hasSaleOrderDraftEdits()).toBe(true)
  })
})
