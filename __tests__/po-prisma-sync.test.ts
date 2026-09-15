import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLoadAppState = vi.fn()
const mockPurchaseOrderFindUnique = vi.fn()
const mockPurchaseOrderUpdate = vi.fn()
const mockPurchaseOrderItemUpdate = vi.fn()

vi.mock('@/lib/server-store', () => ({
  loadAppState: (...args: unknown[]) => mockLoadAppState(...args),
}))

vi.mock('@/lib/inventory/stock-transactions', () => ({
  resolvePrismaProductIdForStock: vi.fn(),
}))

vi.mock('@/lib/legacy-compat', () => ({
  optionalUuid: (value: unknown) => {
    const id = String(value ?? '')
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : null
  },
  resolveClientId: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  default: {
    purchaseOrder: {
      findUnique: (...args: unknown[]) => mockPurchaseOrderFindUnique(...args),
      update: (...args: unknown[]) => mockPurchaseOrderUpdate(...args),
    },
    purchaseOrderItem: {
      update: (...args: unknown[]) => mockPurchaseOrderItemUpdate(...args),
    },
  },
}))

import { ensurePrismaPurchaseOrder, syncPrismaPoReceivedFromBlob } from '@/lib/purchase/po-prisma-sync'

const BLOB_PO_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-111111111111'
const PRISMA_PO_ID = 'bbbbbbbb-cccc-4ddd-8eee-222222222222'
const ITEM_ID = 'cccccccc-dddd-4eee-8fff-333333333333'
const PRODUCT_ID = 'dddddddd-eeee-4fff-8000-444444444444'

describe('syncPrismaPoReceivedFromBlob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('copies blob qtyReceived onto Prisma lines that still show zero received', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_purchaseOrders: [{
        id: BLOB_PO_ID,
        ref: 'PO/2026/0253',
        lines: [{
          id: 'blob-line',
          productId: PRODUCT_ID,
          productName: 'HP ProBook 11 G5 EE',
          qtyReceived: 2,
        }],
      }],
    })
    mockPurchaseOrderFindUnique.mockResolvedValue({
      id: PRISMA_PO_ID,
      items: [{
        id: ITEM_ID,
        productId: PRODUCT_ID,
        description: 'HP ProBook 11 G5 EE',
        qtyOrdered: 2,
        qtyReceived: 0,
      }],
    })

    await syncPrismaPoReceivedFromBlob(PRISMA_PO_ID, BLOB_PO_ID)

    expect(mockPurchaseOrderItemUpdate).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: { qtyReceived: 2 },
    })
    expect(mockPurchaseOrderUpdate).toHaveBeenCalledWith({
      where: { id: PRISMA_PO_ID },
      data: { status: 'received' },
    })
  })

  it('does not decrease a relational received counter', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_purchaseOrders: [{
        id: PRISMA_PO_ID,
        lines: [{ id: 'blob-line', productId: PRODUCT_ID, productName: 'Widget', qtyReceived: 1 }],
      }],
    })
    mockPurchaseOrderFindUnique.mockResolvedValue({
      id: PRISMA_PO_ID,
      items: [{ id: ITEM_ID, productId: PRODUCT_ID, description: 'Widget', qtyOrdered: 5, qtyReceived: 4 }],
    })

    await syncPrismaPoReceivedFromBlob(PRISMA_PO_ID)

    expect(mockPurchaseOrderItemUpdate).not.toHaveBeenCalled()
  })
})

describe('ensurePrismaPurchaseOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadAppState.mockResolvedValue({ deed_purchaseOrders: [] })
  })

  it('heals received qty on an existing Prisma PO before returning its id', async () => {
    mockPurchaseOrderFindUnique.mockResolvedValue({
      id: BLOB_PO_ID,
      items: [{ id: ITEM_ID, productId: PRODUCT_ID, description: 'Widget', qtyOrdered: 1, qtyReceived: 0 }],
    })
    mockLoadAppState.mockResolvedValue({
      deed_purchaseOrders: [{
        id: BLOB_PO_ID,
        lines: [{ id: 'blob-line', productId: PRODUCT_ID, productName: 'Widget', qtyReceived: 1 }],
      }],
    })

    await expect(ensurePrismaPurchaseOrder(BLOB_PO_ID)).resolves.toBe(BLOB_PO_ID)
    expect(mockPurchaseOrderItemUpdate).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: { qtyReceived: 1 },
    })
  })
})
