import { describe, it, expect, beforeEach } from 'vitest'
import {
  markSaleOrderDraftEdit,
  clearSaleOrderDraftEdit,
  hasSaleOrderDraftEdits,
  isSaleOrderDraftEditing,
  stampSaleOrderPersisted,
  mergeSaleOrdersPreservingDraftEdits,
  hydrateSaleOrderDraftEditsFromSession,
  _resetSaleOrderDraftEditStateForTests,
} from '@/lib/sale-order-draft-edits'

describe('mergeSaleOrdersPreservingDraftEdits', () => {
  beforeEach(() => {
    _resetSaleOrderDraftEditStateForTests()
  })

  it('returns remote when no draft edits are pending', () => {
    const local = [{ id: 'so-1', lines: [{ id: 'a', productId: 'p1', qty: 1 }] }]
    const remote = [{ id: 'so-1', lines: [{ id: 'a', productId: 'p1', qty: 1 }, { id: 'b', productId: 'p2', qty: 1 }] }]
    expect(mergeSaleOrdersPreservingDraftEdits(local, remote)).toEqual(remote)
  })

  it('keeps local lines for a draft-edited order when remote still has deleted products', () => {
    markSaleOrderDraftEdit('so-1')
    const local = [
      { id: 'so-1', lines: [{ id: 'a', productId: 'p1', qty: 1, unitPrice: 10, taxRate: 0, subtotal: 10 }] },
      { id: 'so-2', lines: [] },
    ]
    const remote = [
      {
        id: 'so-1',
        lines: [
          { id: 'a', productId: 'p1', qty: 1, unitPrice: 10, taxRate: 0, subtotal: 10 },
          { id: 'b', productId: 'p2', qty: 1, unitPrice: 20, taxRate: 0, subtotal: 20 },
        ],
      },
      { id: 'so-2', lines: [{ id: 'x', productId: 'p9', qty: 1, unitPrice: 1, taxRate: 0, subtotal: 1 }] },
    ]
    const merged = mergeSaleOrdersPreservingDraftEdits(local, remote)
    expect(merged.find(s => s.id === 'so-1')?.lines).toEqual(local[0].lines)
    expect(merged.find(s => s.id === 'so-2')?.lines).toEqual(remote[1].lines)
    expect(hasSaleOrderDraftEdits()).toBe(true)
  })

  it('keeps just-saved lines when stale remote arrives after Save cleared the draft flag', () => {
    const savedLines = [{ id: 'a', productId: 'p1', qty: 1, unitPrice: 10, taxRate: 0, subtotal: 10 }]
    stampSaleOrderPersisted('so-1', savedLines)
    clearSaleOrderDraftEdit('so-1')
    const local = [{ id: 'so-1', lines: savedLines }]
    const remote = [{
      id: 'so-1',
      lines: [
        ...savedLines,
        { id: 'b', productId: 'p2', qty: 1, unitPrice: 20, taxRate: 0, subtotal: 20 },
      ],
    }]
    const merged = mergeSaleOrdersPreservingDraftEdits(local, remote)
    expect(merged.find(s => s.id === 'so-1')?.lines).toEqual(savedLines)
  })

  it('restores draft protection from sessionStorage after a soft remount', () => {
    const store = new Map<string, string>()
    const fakeSession = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
    }
    Object.defineProperty(globalThis, 'sessionStorage', { value: fakeSession, configurable: true })
    Object.defineProperty(globalThis, 'window', {
      value: { sessionStorage: fakeSession },
      configurable: true,
    })

    markSaleOrderDraftEdit('so-session')
    expect(store.get('deed_so_draft_edit_ids')).toContain('so-session')
    const saved = store.get('deed_so_draft_edit_ids')
    _resetSaleOrderDraftEditStateForTests()
    if (saved) store.set('deed_so_draft_edit_ids', saved)
    hydrateSaleOrderDraftEditsFromSession()
    expect(isSaleOrderDraftEditing('so-session')).toBe(true)
    expect(hasSaleOrderDraftEdits()).toBe(true)
  })
})
