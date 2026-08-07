import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
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
  beginHardSaleOrderPersist,
  endHardSaleOrderPersist,
  waitForDraftSaleOrderPersistIdle,
  cancelDraftSaleOrderLinePersist,
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
    Object.defineProperty(globalThis, 'window', {
      value: globalThis,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls updateSaleOrder with persist+soft and skipBroadcast', async () => {
    markSaleOrderDraftEdit('so-1')
    const updateSaleOrder = vi.fn(async () => true)
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
    expect(updateSaleOrder.mock.calls[0][1]).toMatchObject({ skipBroadcast: true })
    expect(updateSaleOrder.mock.calls[0][2]).toEqual({ persist: true, soft: true })
    expect(isSaleOrderDraftEditing('so-1')).toBe(true)
  })

  it('Save cancels soft timer and waits for idle before hard persist', async () => {
    markSaleOrderDraftEdit('so-1')
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const updateSaleOrder = vi.fn(async () => {
      await gate
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
    expect(updateSaleOrder).toHaveBeenCalledTimes(1)

    beginHardSaleOrderPersist('so-1')
    // Further soft schedules must no-op while hard-saving.
    scheduleDraftSaleOrderLinePersist('so-1')
    await vi.advanceTimersByTimeAsync(450)
    expect(updateSaleOrder).toHaveBeenCalledTimes(1)

    const idle = waitForDraftSaleOrderPersistIdle('so-1')
    release()
    await idle
    endHardSaleOrderPersist('so-1')
  })

  it('cancelDraftSaleOrderLinePersist prevents a pending soft flush', async () => {
    markSaleOrderDraftEdit('so-1')
    const updateSaleOrder = vi.fn(async () => true)
    registerSaleOrderDraftPersistApi({
      updateSaleOrder,
      getSaleOrder: () => ({ id: 'so-1', lines: [] }),
    })
    scheduleDraftSaleOrderLinePersist('so-1')
    cancelDraftSaleOrderLinePersist('so-1')
    await vi.advanceTimersByTimeAsync(450)
    await Promise.resolve()
    expect(updateSaleOrder).not.toHaveBeenCalled()
  })

  it('stampSaleOrderPersisted is only for explicit Save (soft path must not call it)', () => {
    markSaleOrderDraftEdit('so-1')
    expect(isSaleOrderDraftEditing('so-1')).toBe(true)
    stampSaleOrderPersisted('so-1', [{ id: 'a', productId: 'p1', qty: 1, unitPrice: 1, subtotal: 1 }])
    expect(isSaleOrderDraftEditing('so-1')).toBe(false)
  })
})
