import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ bill: null as any, poItems: [] as any[], update: vi.fn(), notify: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/server-store', () => ({ notifyStoreKeysChanged: m.notify }))
vi.mock('@/lib/prisma', () => ({
  default: {
    invoice: { findUnique: vi.fn(async () => m.bill) },
    purchaseOrderItem: { findMany: vi.fn(async () => m.poItems), update: m.update },
  },
}))

import { releaseCancelledBillQty } from '@/lib/purchase/release-cancelled-bill.server'

beforeEach(() => {
  vi.clearAllMocks()
  m.notify.mockResolvedValue(undefined)
  m.poItems = [{ id: 'pl1', productId: 'screen', qtyBilled: 1 }, { id: 'pl2', productId: 'ram', qtyBilled: 2 }]
  m.bill = { purchaseOrderId: 'po1', documentType: 'vendor_bill', totalAmount: 23000, items: [{ qty: 1, productId: 'screen', purchaseOrderItemId: 'pl1' }] }
})

describe('cancelling a bill releases its quantities on the purchase order', () => {
  it('gives the billed units back to the PO line (BILL/2026/0267)', async () => {
    expect(await releaseCancelledBillQty('b1')).toBe(1)
    expect(m.update).toHaveBeenCalledWith({ where: { id: 'pl1' }, data: { qtyBilled: 0 } })
    expect(m.notify).toHaveBeenCalledWith(['deed_purchaseOrders'])
  })

  it('older lines without a PO line id match by product; never below zero', async () => {
    m.bill.items = [{ qty: 5, productId: 'ram', purchaseOrderItemId: null }]
    expect(await releaseCancelledBillQty('b1')).toBe(2)
    expect(m.update).toHaveBeenCalledWith({ where: { id: 'pl2' }, data: { qtyBilled: 0 } })
  })

  it('ignores customer invoices, credit notes and bills without an order', async () => {
    for (const bill of [
      { ...m.bill, documentType: 'customer_invoice' },
      { ...m.bill, totalAmount: -23000 },
      { ...m.bill, purchaseOrderId: null },
    ]) {
      m.bill = bill
      expect(await releaseCancelledBillQty('b1')).toBe(0)
    }
    expect(m.update).not.toHaveBeenCalled()
  })
})
