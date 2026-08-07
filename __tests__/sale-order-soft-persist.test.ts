import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  markSaleOrderDraftEdit,
  isSaleOrderDraftEditing,
  saleOrderLinesFingerprint,
  stampSaleOrderPersisted,
  _resetSaleOrderDraftEditStateForTests,
} from '@/lib/sale-order-draft-edits'
import {
  registerSaleOrderDraftPersistApi,
  scheduleDraftSaleOrderLinePersist,
  _resetDraftSaleOrderPersistForTests,
} from '@/lib/sale-order-draft-persist'

describe('saleOrderLinesFingerprint', () => {
  it('changes when a line is removed', () => {
    const withTwo = [
      { id: 'a', productId: 'p1', qty: 1, unitPrice: 10, subtotal: 10 },
      { id: 'b', productId: 'p2', qty: 1, unitPrice: 20, subtotal: 20 },
    ]
    const withOne = [withTwo[0]]
    expect(saleOrderLinesFingerprint(withOne)).not.toBe(saleOrderLinesFingerprint(withTwo))
  })
})

describe('soft draft persist', () => {
  beforeEach(() => {
    _resetSaleOrderDraftEditStateForTests()
    _resetDraftSaleOrderPersistForTests()
    vi.useFakeTimers()
    // scheduleDraftSaleOrderLinePersist is browser-only
    Object.defineProperty(globalThis, 'window', {
      value: globalThis,
      configurable: true,
    })
  })

  it('calls updateSaleOrder with persist+soft and never clears draft editing', async () => {
    markSaleOrderDraftEdit('so-1')
    const updateSaleOrder = vi.fn(async () => {
      // Soft persist must leave the draft mark alone (unlike stampSaleOrderPersisted).
      expect(isSaleOrderDraftEditing('so-1')).toBe(true)
      return true
    })
    registerSaleOrderDraftPersistApi({
      updateSaleOrder,
      getSaleOrder: () => ({
        id: 'so-1',
        lines: [{ id: 'a', productId: 'p1', qty: 1 }],
        subtotal: 10,
        taxTotal: 0,
        discountAmount: 0,
        total: 10,
      }),
    })

    scheduleDraftSaleOrderLinePersist('so-1')
    await vi.advanceTimersByTimeAsync(450)
    await Promise.resolve()

    expect(updateSaleOrder).toHaveBeenCalledTimes(1)
    expect(updateSaleOrder.mock.calls[0][2]).toEqual({ persist: true, soft: true })
    expect(isSaleOrderDraftEditing('so-1')).toBe(true)
  })

  it('coalesces overlapping soft persists so only one PATCH runs at a time', async () => {
    markSaleOrderDraftEdit('so-1')
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const updateSaleOrder = vi.fn(async () => {
      await gate
      return true
    })
    let lines = [{ id: 'a', productId: 'p1', qty: 1 }]
    registerSaleOrderDraftPersistApi({
      updateSaleOrder,
      getSaleOrder: () => ({
        id: 'so-1',
        lines,
        subtotal: 10,
        taxTotal: 0,
        discountAmount: 0,
        total: 10,
      }),
    })

    scheduleDraftSaleOrderLinePersist('so-1')
    await vi.advanceTimersByTimeAsync(450)
    // First persist in flight — further schedules should queue, not start another timer PATCH.
    lines = [{ id: 'a', productId: 'p1', qty: 1 }, { id: 'b', productId: 'p2', qty: 1 }]
    scheduleDraftSaleOrderLinePersist('so-1')
    scheduleDraftSaleOrderLinePersist('so-1')
    expect(updateSaleOrder).toHaveBeenCalledTimes(1)

    release()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(450)
    await Promise.resolve()
    expect(updateSaleOrder).toHaveBeenCalledTimes(2)
    expect(updateSaleOrder.mock.calls.every(c => c[2]?.soft === true)).toBe(true)
  })

  it('stampSaleOrderPersisted is only for explicit Save (soft path must not call it)', () => {
    markSaleOrderDraftEdit('so-1')
    expect(isSaleOrderDraftEditing('so-1')).toBe(true)
    stampSaleOrderPersisted('so-1', [{ id: 'a', productId: 'p1', qty: 1, unitPrice: 1, subtotal: 1 }])
    expect(isSaleOrderDraftEditing('so-1')).toBe(false)
  })
})
