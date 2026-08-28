/**
 * Regression: a draft bill reserves qtyBilled on its PO lines at creation.
 * Posting that same bill must not treat its own reservation as consumed by
 * someone else — the Elevetus bill (3× Lenovo, received 3, billed 3 by
 * itself) was rejected with "exceeds received/unbilled 0".
 */
import { describe, it, expect, vi } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    $transaction: vi.fn((fn: any) => fn(mockPrisma)),
    purchaseOrder: { findUnique: vi.fn() },
    purchaseOrderItem: { updateMany: vi.fn() },
    invoice: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))

import {
  assertVendorBillThreeWayMatchInTx,
  assertVendorBillThreeWayMatchServer,
} from '@/lib/purchase/assert-bill-match.server'

const PO_ID = 'd83fbb24-5e88-48ba-afb8-fd0c37069880'
const BILL_ID = '9be921b6-de28-4772-8200-972e1b894c41'
const PRODUCT_ID = '3fb6e6db-c5d0-4411-a661-59d387b1123b'
const PO_ITEM_ID = '2a185053-d75a-4673-8024-0c01aacfeefb'

function setup() {
  mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
    id: PO_ID,
    poNumber: 'PO/2026/0087',
    clientId: 'client-1',
    items: [{ id: PO_ITEM_ID, productId: PRODUCT_ID, qtyOrdered: 3, qtyReceived: 3, qtyBilled: 3, unitCost: 74500, taxRate: 0 }],
  })
  mockPrisma.invoice.findUnique.mockResolvedValue({
    id: BILL_ID,
    items: [{ productId: PRODUCT_ID, qty: 3 }],
  })
  mockPrisma.purchaseOrderItem.updateMany.mockResolvedValue({ count: 1 })
}

describe('vendor bill 3-way match — own reservation excluded', () => {
  it('posts a bill whose qty was already reserved by itself at creation', async () => {
    setup()
    const result = await assertVendorBillThreeWayMatchInTx(mockPrisma as any, {
      purchaseOrderId: PO_ID,
      billLines: [{ productId: PRODUCT_ID, qty: 3, unitPrice: 74500, taxRate: 0 }],
      excludeBillId: BILL_ID,
    })
    expect(result.ok).toBe(true)
    // No additional quantity to reserve — the bill's own reservation covers it.
    expect(mockPrisma.purchaseOrderItem.updateMany).not.toHaveBeenCalled()
  })

  it('still rejects when the bill exceeds its own reservation plus unbilled', async () => {
    setup()
    await expect(assertVendorBillThreeWayMatchInTx(mockPrisma as any, {
      purchaseOrderId: PO_ID,
      billLines: [{ productId: PRODUCT_ID, qty: 4, unitPrice: 74500, taxRate: 0 }],
      excludeBillId: BILL_ID,
    })).rejects.toThrow(/3-way match failed/)
  })

  it('reserves only the increment when the bill grew after creation', async () => {
    setup()
    // PO has 4 received; the bill reserved 3 at creation and now posts 4.
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
      id: PO_ID,
      poNumber: 'PO/2026/0087',
      clientId: 'client-1',
      items: [{ id: PO_ITEM_ID, productId: PRODUCT_ID, qtyOrdered: 4, qtyReceived: 4, qtyBilled: 3, unitCost: 74500, taxRate: 0 }],
    })
    const result = await assertVendorBillThreeWayMatchInTx(mockPrisma as any, {
      purchaseOrderId: PO_ID,
      billLines: [{ productId: PRODUCT_ID, qty: 4, unitPrice: 74500, taxRate: 0 }],
      excludeBillId: BILL_ID,
    })
    expect(result.ok).toBe(true)
    expect(mockPrisma.purchaseOrderItem.updateMany).toHaveBeenCalledWith({
      where: { id: PO_ITEM_ID, qtyBilled: 3 },
      data: { qtyBilled: { increment: 1 } },
    })
  })

  it('preflight also excludes the bill being posted', async () => {
    setup()
    const result = await assertVendorBillThreeWayMatchServer({
      purchaseOrderId: PO_ID,
      billLines: [{ productId: PRODUCT_ID, qty: 3 }],
      excludeBillId: BILL_ID,
    })
    expect(result.ok).toBe(true)
  })
})
