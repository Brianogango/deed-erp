import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFindUnique = vi.fn()
const mockItemUpdate = vi.fn()
const mockLoadAppState = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    purchaseOrder: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
    purchaseOrderItem: { update: (...args: unknown[]) => mockItemUpdate(...args) },
  },
}))

vi.mock('@/lib/server-store', () => ({
  loadAppState: (...args: unknown[]) => mockLoadAppState(...args),
}))

import { reconcilePrismaPoReceivedQty } from '@/lib/purchase/reconcile-po-received.server'

const PO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ITEM_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

describe('reconcilePrismaPoReceivedQty', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockItemUpdate.mockResolvedValue({})
  })

  it('does not write when Prisma already has the received quantity', async () => {
    mockFindUnique.mockResolvedValue({
      id: PO_ID,
      poNumber: 'PO/2026/0178',
      items: [{ id: ITEM_ID, productId: 'p1', description: 'Widget', qtyOrdered: 1, qtyReceived: 1 }],
      grns: [],
    })
    mockLoadAppState.mockResolvedValue({ deed_purchaseOrders: [] })

    await reconcilePrismaPoReceivedQty(PO_ID)

    expect(mockItemUpdate).not.toHaveBeenCalled()
  })

  it('heals qtyReceived from a validated blob PO when Prisma still shows zero', async () => {
    mockFindUnique.mockResolvedValue({
      id: PO_ID,
      poNumber: 'PO/2026/0178',
      items: [{ id: ITEM_ID, productId: 'prisma-product', description: 'Bluecom widget', qtyOrdered: 1, qtyReceived: 0 }],
      grns: [],
    })
    mockLoadAppState.mockResolvedValue({
      deed_purchaseOrders: [{
        id: PO_ID,
        ref: 'PO/2026/0178',
        lines: [{ id: 'blob-line', productId: 'blob-product', productName: 'Bluecom widget', qtyReceived: 1 }],
      }],
    })

    await reconcilePrismaPoReceivedQty(PO_ID)

    expect(mockItemUpdate).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: { qtyReceived: 1 },
    })
  })

  it('heals qtyReceived from GRN items even when the blob is stale', async () => {
    mockFindUnique.mockResolvedValue({
      id: PO_ID,
      poNumber: 'PO/2026/0178',
      items: [{ id: ITEM_ID, productId: 'p1', description: 'Widget', qtyOrdered: 2, qtyReceived: 0 }],
      grns: [{ items: [{ poItemId: ITEM_ID, qtyReceived: 2 }] }],
    })
    mockLoadAppState.mockResolvedValue({
      deed_purchaseOrders: [{
        id: PO_ID,
        ref: 'PO/2026/0178',
        lines: [{ id: ITEM_ID, productId: 'p1', productName: 'Widget', qtyReceived: 0 }],
      }],
    })

    await reconcilePrismaPoReceivedQty(PO_ID)

    expect(mockItemUpdate).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: { qtyReceived: 2 },
    })
  })
})
