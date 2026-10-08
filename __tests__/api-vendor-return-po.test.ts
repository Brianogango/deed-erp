import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockPrisma, mockNotify } = vi.hoisted(() => ({
  mockPrisma: {
    purchaseOrder: { findUnique: vi.fn(), update: vi.fn() },
    purchaseOrderItem: { update: vi.fn() },
  },
  mockNotify: vi.fn(),
}))
vi.mock('@/lib/auth/server', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1', role: 'inventory_officer' } })) }))
vi.mock('@/lib/inventory/stock-transactions', () => ({ applyVendorReturnStockMutation: vi.fn(async () => ({ ok: true, moves: [] })) }))
vi.mock('@/lib/inventory/valuation-hooks', () => ({ postVendorReturnValuation: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('@/lib/server-store', () => ({ notifyStoreKeysChanged: mockNotify }))

import { POST } from '@/app/api/inventory/apply-vendor-return-stock/route'

const PO_ID = '11111111-2222-4333-8444-555555555555'
const req = (po: unknown) => new NextRequest('http://x', {
  method: 'POST',
  body: JSON.stringify({ returnRef: 'RTV/1', lines: [{ productId: 'p', productName: 'P', qty: 1 }], po }),
})

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
    id: PO_ID, status: 'received',
    items: [{ id: 'it-1', qtyOrdered: 3, qtyReceived: 3, qtyBilled: 2 }],
  })
})

describe('vendor return winds back the purchase order', () => {
  it('lowers the counts and reopens a received order as partial', async () => {
    const res = await POST(req({ id: PO_ID, lines: [{ poLineId: 'it-1', qtyReceived: 2, qtyBilled: 1 }] }))
    expect(res.status).toBe(200)
    expect(mockPrisma.purchaseOrderItem.update).toHaveBeenCalledWith({ where: { id: 'it-1' }, data: { qtyReceived: 2, qtyBilled: 1 } })
    expect(mockPrisma.purchaseOrder.update).toHaveBeenCalledWith({ where: { id: PO_ID }, data: { status: 'partial' } })
    expect(mockNotify).toHaveBeenCalledWith(['deed_purchaseOrders'])
  })

  it('never raises a count', async () => {
    await POST(req({ id: PO_ID, lines: [{ poLineId: 'it-1', qtyReceived: 9, qtyBilled: 9 }] }))
    expect(mockPrisma.purchaseOrderItem.update).not.toHaveBeenCalled()
    expect(mockPrisma.purchaseOrder.update).not.toHaveBeenCalled()
  })
})
