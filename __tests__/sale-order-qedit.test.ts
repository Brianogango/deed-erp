/**
 * QEDIT — Draft quotation line editing invariants.
 *
 * Sales invariant: for an editable draft quotation, after a successful save,
 * UI line set = API payload line set = persisted nested-write line set, with
 * no deleted line resurrecting after refresh or navigation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildSaleOrderItemsNestedWrite } from '@/lib/sale-order-items-write'
import {
  markSaleOrderDraftEdit,
  isSaleOrderDraftEditing,
  saleOrderLinesFingerprint,
  mergeSaleOrdersPreservingDraftEdits,
  stampSaleOrderPersisted,
  _resetSaleOrderDraftEditStateForTests,
} from '@/lib/sale-order-draft-edits'
import {
  registerSaleOrderDraftPersistApi,
  scheduleDraftSaleOrderLinePersist,
  beginHardSaleOrderPersist,
  endHardSaleOrderPersist,
  waitForDraftSaleOrderPersistIdle,
  _resetDraftSaleOrderPersistForTests,
} from '@/lib/sale-order-draft-persist'

// UUIDs must pass legacy-compat isUuid (version 1–5 + RFC variant).
const A = {
  id: 'a1111111-1111-4111-8111-111111111111',
  productId: 'a2222222-2222-4222-8222-222222222222',
  description: 'Product A',
  qty: 1,
  unitPrice: 100,
  taxRate: 16,
  lineTotal: 100,
  qtyDelivered: 0,
  qtyInvoiced: 0,
  notes: null,
  serialNumberId: null,
}
const B = {
  id: 'b1111111-1111-4111-8111-111111111111',
  productId: 'b2222222-2222-4222-8222-222222222222',
  description: 'Product B',
  qty: 1,
  unitPrice: 200,
  taxRate: 16,
  lineTotal: 200,
  qtyDelivered: 0,
  qtyInvoiced: 0,
  notes: null,
  serialNumberId: null,
}
const C = {
  id: 'c1111111-1111-4111-8111-111111111111',
  productId: 'c2222222-2222-4222-8222-222222222222',
  description: 'Product C',
  qty: 1,
  unitPrice: 300,
  taxRate: 16,
  lineTotal: 300,
  qtyDelivered: 0,
  qtyInvoiced: 0,
  notes: null,
  serialNumberId: null,
}
const D = {
  id: 'd1111111-1111-4111-8111-111111111111',
  productId: 'd2222222-2222-4222-8222-222222222222',
  description: 'Product D',
  qty: 2,
  unitPrice: 50,
  taxRate: 16,
  lineTotal: 100,
  qtyDelivered: 0,
  qtyInvoiced: 0,
  notes: null,
  serialNumberId: null,
}

function productIds(nested: ReturnType<typeof buildSaleOrderItemsNestedWrite>, existing: typeof A[]) {
  const kept = new Set(
    (nested.update ?? []).map(u => u.where.id),
  )
  const createdProductIds = (nested.create ?? []).map(c => c.productId)
  const deleted = new Set(
    nested.deleteMany && 'id' in nested.deleteMany && nested.deleteMany.id && 'in' in nested.deleteMany.id
      ? (nested.deleteMany.id.in as string[])
      : [],
  )
  const finalExisting = existing.filter(e => !deleted.has(e.id) && kept.has(e.id))
  return {
    updateIds: [...kept],
    deleteIds: [...deleted],
    createProductIds: createdProductIds,
    finalProductIds: [
      ...finalExisting.map(e => e.productId),
      ...createdProductIds,
    ].sort(),
  }
}

describe('QEDIT nested Prisma line reconciliation', () => {
  it('QEDIT-001 — Edit quantity A qty1 → A qty3', () => {
    const nested = buildSaleOrderItemsNestedWrite(
      [{ ...A, qty: 3, lineTotal: 300 }],
      [A, B],
    )
    expect(nested.update?.[0].data.qty).toBe(3)
    expect(nested.deleteMany).toEqual({ id: { in: [B.id] } })
    expect(nested.create).toBeUndefined()
  })

  it('QEDIT-002 — Add line A → A+B', () => {
    const nested = buildSaleOrderItemsNestedWrite([A, B], [A])
    const result = productIds(nested, [A])
    expect(result.deleteIds).toEqual([])
    expect(result.createProductIds).toContain(B.productId)
    expect(result.finalProductIds).toEqual([A.productId, B.productId].sort())
  })

  it('QEDIT-003 — Remove line A+B → A (B deleted, not left orphaned)', () => {
    const nested = buildSaleOrderItemsNestedWrite([A], [A, B])
    expect(nested.deleteMany).toEqual({ id: { in: [B.id] } })
    expect(nested.update?.map(u => u.where.id)).toEqual([A.id])
    expect(nested.create).toBeUndefined()
    const result = productIds(nested, [A, B])
    expect(result.finalProductIds).toEqual([A.productId])
  })

  it('QEDIT-004 — Replace line A+B → A+C', () => {
    const nested = buildSaleOrderItemsNestedWrite([A, C], [A, B])
    const result = productIds(nested, [A, B])
    expect(result.deleteIds).toContain(B.id)
    expect(result.createProductIds).toContain(C.productId)
    expect(result.finalProductIds).toEqual([A.productId, C.productId].sort())
    expect(result.finalProductIds).not.toContain(B.productId)
  })

  it('QEDIT-005 — Multiple changes A+B+C → modify A, delete B, retain C, add D', () => {
    const nested = buildSaleOrderItemsNestedWrite(
      [{ ...A, qty: 5, lineTotal: 500 }, C, D],
      [A, B, C],
    )
    const result = productIds(nested, [A, B, C])
    expect(result.deleteIds).toEqual([B.id])
    expect(nested.update?.find(u => u.where.id === A.id)?.data.qty).toBe(5)
    expect(nested.update?.find(u => u.where.id === C.id)).toBeTruthy()
    expect(result.createProductIds).toEqual([D.productId])
    expect(result.finalProductIds).toEqual(
      [A.productId, C.productId, D.productId].sort(),
    )
    expect(result.finalProductIds).not.toContain(B.productId)
  })

  it('QEDIT-006 — Delete all lines yields deleteMany for every existing row', () => {
    // Business rule: confirm requires ≥1 line (UI/store). Empty draft save is
    // allowed at the nested-write layer; it must not silently keep old lines.
    const nested = buildSaleOrderItemsNestedWrite([], [A, B])
    expect(nested.deleteMany).toEqual({ id: { in: [A.id, B.id] } })
    expect(nested.update).toBeUndefined()
    expect(nested.create).toBeUndefined()
  })

  it('QEDIT-007 — Repeated saves stay deterministic (A then A+C then A)', () => {
    const s1 = buildSaleOrderItemsNestedWrite([A], [A, B])
    expect(productIds(s1, [A, B]).finalProductIds).toEqual([A.productId])

    const afterS1 = [A] // B gone
    const s2 = buildSaleOrderItemsNestedWrite([A, C], afterS1)
    expect(productIds(s2, afterS1).finalProductIds.sort()).toEqual(
      [A.productId, C.productId].sort(),
    )

    const afterS2 = [A, { ...C, id: 'new-c-id', productId: C.productId }]
    const s3 = buildSaleOrderItemsNestedWrite([A], afterS2)
    expect(productIds(s3, afterS2).finalProductIds).toEqual([A.productId])
  })

  it('QEDIT-010 — Double submit with same payload does not duplicate lines', () => {
    const first = buildSaleOrderItemsNestedWrite([A, C], [A, B])
    const mid = [
      A,
      { ...C, id: 'created-c' },
    ]
    const second = buildSaleOrderItemsNestedWrite([A, { ...C, id: 'created-c' }], mid)
    expect(second.create).toBeUndefined()
    expect(second.deleteMany).toBeUndefined()
    expect(second.update).toHaveLength(2)
    // Same commercial set — no extra create on the second identical save.
    expect(productIds(first, [A, B]).finalProductIds).toEqual(
      productIds(second, mid).finalProductIds,
    )
  })
})

describe('QEDIT soft-persist / hydration races', () => {
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

  it('QEDIT-008/009 — after Save stamp, stale remote with more lines does not win', () => {
    const local = [{ id: 'so-1', lines: [A] }]
    stampSaleOrderPersisted('so-1', [A])
    const remote = [{ id: 'so-1', lines: [A, B] }]
    const merged = mergeSaleOrdersPreservingDraftEdits(local, remote)
    expect(saleOrderLinesFingerprint(merged[0].lines)).toBe(saleOrderLinesFingerprint([A]))
  })

  it('QEDIT-011 — overlapping soft flushes are chained (stale Soft#1 cannot race Soft#2)', async () => {
    markSaleOrderDraftEdit('so-1')
    const order = { current: { id: 'so-1', lines: [A, B] as unknown[], subtotal: 300, taxTotal: 0, discountAmount: 0, total: 300 } }
    const calls: string[] = []
    let soft1Release!: () => void
    const soft1Gate = new Promise<void>(r => { soft1Release = r })
    let callCount = 0

    const updateSaleOrder = vi.fn(async (_id: string, patch: Record<string, unknown>) => {
      callCount += 1
      const n = callCount
      const fp = saleOrderLinesFingerprint(patch.lines)
      calls.push(`start-${n}:${fp}`)
      if (n === 1) await soft1Gate
      calls.push(`end-${n}:${fp}`)
      return true
    })

    registerSaleOrderDraftPersistApi({
      updateSaleOrder,
      getSaleOrder: () => order.current as any,
    })

    // Soft#1 scheduled with A+B
    scheduleDraftSaleOrderLinePersist('so-1')
    await vi.advanceTimersByTimeAsync(450)
    expect(updateSaleOrder).toHaveBeenCalledTimes(1)

    // User deletes B, Soft#2 scheduled — must not start until Soft#1 ends
    order.current = { ...order.current, lines: [A] }
    scheduleDraftSaleOrderLinePersist('so-1')
    await vi.advanceTimersByTimeAsync(450)
    expect(updateSaleOrder).toHaveBeenCalledTimes(1)

    soft1Release()
    await waitForDraftSaleOrderPersistIdle('so-1')
    await Promise.resolve()
    await Promise.resolve()

    expect(updateSaleOrder).toHaveBeenCalledTimes(2)
    // Soft#2 must observe the post-delete line set (generation may skip Soft#1 body;
    // Soft#2 starts only after Soft#1 completes).
    const secondPatch = updateSaleOrder.mock.calls[1]?.[1] as { lines: unknown }
    expect(saleOrderLinesFingerprint(secondPatch.lines)).toBe(saleOrderLinesFingerprint([A]))
    // Ordering: Soft#1 ends before Soft#2 starts
    const end1 = calls.findIndex(c => c.startsWith('end-1'))
    const start2 = calls.findIndex(c => c.startsWith('start-2'))
    expect(end1).toBeGreaterThanOrEqual(0)
    expect(start2).toBeGreaterThan(end1)
  })

  it('QEDIT-012 — Save hard gate blocks further soft schedules', async () => {
    markSaleOrderDraftEdit('so-1')
    const updateSaleOrder = vi.fn(async () => true)
    registerSaleOrderDraftPersistApi({
      updateSaleOrder,
      getSaleOrder: () => ({ id: 'so-1', lines: [A] }),
    })
    beginHardSaleOrderPersist('so-1')
    scheduleDraftSaleOrderLinePersist('so-1')
    await vi.advanceTimersByTimeAsync(450)
    expect(updateSaleOrder).not.toHaveBeenCalled()
    endHardSaleOrderPersist('so-1')
    expect(isSaleOrderDraftEditing('so-1')).toBe(true)
  })
})
