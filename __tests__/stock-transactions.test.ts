import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockLoadAppState = vi.fn()
const mockSaveStoreKeys = vi.fn()
const mockPrismaTransaction = vi.fn()
const mockStockLevelFindUnique = vi.fn()
const mockStockLevelUpdate = vi.fn()
const mockStockLevelCreate = vi.fn()
const mockProductFindUnique = vi.fn()
const mockProductFindFirst = vi.fn()
const mockProductCreate = vi.fn()
const mockStockReservationFindMany = vi.fn()
const mockSaleOrderFindUnique = vi.fn()
const mockMirrorReservations = vi.fn()
const mockPurchaseOrderFindUnique = vi.fn()
const mockPurchaseOrderUpdate = vi.fn()
const mockPurchaseOrderItemUpdate = vi.fn()
const mockPurchaseOrderItemFindMany = vi.fn()
const mockPurchaseOrderItemFindUnique = vi.fn()
const mockGoodsReceivedNoteCreate = vi.fn()
const mockGoodsReceivedNoteFindUnique = vi.fn()
const mockGoodsReceivedNoteDelete = vi.fn()
const mockGrnItemCreate = vi.fn()
const mockSerialNumberCreate = vi.fn()
const mockSerialNumberUpdateMany = vi.fn()
const mockInventoryBatchUpdateMany = vi.fn()

vi.mock('@/lib/server-store', () => ({
  loadAppState: (...args: unknown[]) => mockLoadAppState(...args),
  saveStoreKeys: (...args: unknown[]) => mockSaveStoreKeys(...args),
  withAppStateKeyLock: (_key: string, fn: () => Promise<unknown>) => fn(),
}))

vi.mock('@/lib/inventory/reservation-mirror', () => ({
  mirrorStockReservationsToPrisma: (...args: unknown[]) => mockMirrorReservations(...args),
}))

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: (fn: (tx: unknown) => Promise<void>) => mockPrismaTransaction(fn),
    stockLevel: {
      findUnique: (...args: unknown[]) => mockStockLevelFindUnique(...args),
      update: (...args: unknown[]) => mockStockLevelUpdate(...args),
      create: (...args: unknown[]) => mockStockLevelCreate(...args),
    },
    product: {
      findUnique: (...args: unknown[]) => mockProductFindUnique(...args),
      findFirst: (...args: unknown[]) => mockProductFindFirst(...args),
      create: (...args: unknown[]) => mockProductCreate(...args),
    },
    stockReservation: {
      findMany: (...args: unknown[]) => mockStockReservationFindMany(...args),
    },
    saleOrder: {
      findUnique: (...args: unknown[]) => mockSaleOrderFindUnique(...args),
    },
    purchaseOrder: {
      findUnique: (...args: unknown[]) => mockPurchaseOrderFindUnique(...args),
      update: (...args: unknown[]) => mockPurchaseOrderUpdate(...args),
    },
    purchaseOrderItem: {
      update: (...args: unknown[]) => mockPurchaseOrderItemUpdate(...args),
      findMany: (...args: unknown[]) => mockPurchaseOrderItemFindMany(...args),
      findUnique: (...args: unknown[]) => mockPurchaseOrderItemFindUnique(...args),
    },
    goodsReceivedNote: {
      create: (...args: unknown[]) => mockGoodsReceivedNoteCreate(...args),
      findUnique: (...args: unknown[]) => mockGoodsReceivedNoteFindUnique(...args),
      delete: (...args: unknown[]) => mockGoodsReceivedNoteDelete(...args),
    },
    grnItem: {
      create: (...args: unknown[]) => mockGrnItemCreate(...args),
    },
    serialNumber: {
      create: (...args: unknown[]) => mockSerialNumberCreate(...args),
      updateMany: (...args: unknown[]) => mockSerialNumberUpdateMany(...args),
    },
    inventoryBatch: {
      updateMany: (...args: unknown[]) => mockInventoryBatchUpdateMany(...args),
    },
  },
}))

import { applyDeliveryStockMutation, applyReceiptStockMutation, applyPosStockMutation, reserveStockForSaleOrder, reverseReceiptStockMutation } from '@/lib/inventory/stock-transactions'

const PRODUCT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const PRISMA_PRODUCT_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'

beforeEach(() => {
  vi.clearAllMocks()
  mockSaveStoreKeys.mockResolvedValue(undefined)
  mockPrismaTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
    await fn({
      stockLevel: {
        findUnique: mockStockLevelFindUnique,
        update: mockStockLevelUpdate,
        create: mockStockLevelCreate,
      },
      product: {
        findUnique: mockProductFindUnique,
        findFirst: mockProductFindFirst,
        create: mockProductCreate,
      },
      purchaseOrder: {
        findUnique: mockPurchaseOrderFindUnique,
        update: mockPurchaseOrderUpdate,
      },
      purchaseOrderItem: {
        update: mockPurchaseOrderItemUpdate,
        findMany: mockPurchaseOrderItemFindMany,
        findUnique: mockPurchaseOrderItemFindUnique,
      },
      goodsReceivedNote: {
        create: mockGoodsReceivedNoteCreate,
        findUnique: mockGoodsReceivedNoteFindUnique,
        delete: mockGoodsReceivedNoteDelete,
      },
      grnItem: {
        create: mockGrnItemCreate,
      },
      serialNumber: {
        create: mockSerialNumberCreate,
        updateMany: mockSerialNumberUpdateMany,
      },
      inventoryBatch: {
        updateMany: mockInventoryBatchUpdateMany,
      },
    })
  })
  mockStockLevelFindUnique.mockResolvedValue({ qtyOnHand: 20, qtyReserved: 0 })
  mockStockLevelUpdate.mockResolvedValue({})
  mockStockLevelCreate.mockResolvedValue({})
  mockProductFindUnique.mockResolvedValue({ id: PRODUCT_ID })
  mockProductFindFirst.mockResolvedValue(null)
  mockProductCreate.mockResolvedValue({ id: PRODUCT_ID, sku: 'WIDGET' })
  mockStockReservationFindMany.mockResolvedValue([])
  mockMirrorReservations.mockResolvedValue({ mirrored: 1, skipped: 0, failed: 0 })
  mockPurchaseOrderFindUnique.mockResolvedValue(null)
  mockPurchaseOrderUpdate.mockResolvedValue({})
  mockPurchaseOrderItemUpdate.mockResolvedValue({})
  mockPurchaseOrderItemFindMany.mockImplementation(async () => {
    const po = await mockPurchaseOrderFindUnique.mock.results.at(-1)?.value
    const items = [...((po as { items?: Array<Record<string, unknown>> } | null)?.items ?? [])]
    for (const [arg] of mockPurchaseOrderItemUpdate.mock.calls as Array<[{ where: { id: string }; data: Record<string, unknown> }]>) {
      const index = items.findIndex(item => item.id === arg.where.id)
      if (index >= 0) items[index] = { ...items[index], ...arg.data }
    }
    return items
  })
  mockGoodsReceivedNoteCreate.mockResolvedValue({ id: 'grn-1' })
  mockGoodsReceivedNoteFindUnique.mockResolvedValue(null)
  mockGoodsReceivedNoteDelete.mockResolvedValue({})
  mockGrnItemCreate.mockResolvedValue({ id: 'grn-item-1' })
  mockSerialNumberCreate.mockResolvedValue({})
  mockSerialNumberUpdateMany.mockResolvedValue({ count: 0 })
  mockInventoryBatchUpdateMany.mockResolvedValue({ count: 0 })
  mockPurchaseOrderItemFindUnique.mockResolvedValue(null)
})

describe('applyDeliveryStockMutation()', () => {
  it('deducts bulk stock and persists blob updates when stock is available', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_products: [{ id: PRODUCT_ID, name: 'Widget', stockQty: 10, requiresSerial: false, unit: 'pcs' }],
      deed_serials: [],
      deed_bulkStock: [{ productId: PRODUCT_ID, location: 'warehouse', qty: 10 }],
      deed_stockMoves: [],
      deed_stockReservations: [],
    })

    const result = await applyDeliveryStockMutation({
      deliveryId: 'del-1',
      deliveryRef: 'DN/2026/0001',
      saleOrderId: 'so-1',
      lines: [{ productId: PRODUCT_ID, productName: 'Widget', qty: 2, sourceLocation: 'warehouse' }],
      userId: 'user-1',
    })

    expect(result).toEqual({ ok: true })
    expect(mockSaveStoreKeys).toHaveBeenCalled()
    const payload = mockSaveStoreKeys.mock.calls[0][0]
    const products = JSON.parse(payload.deed_products)
    expect(products[0].stockQty).toBe(8)
    const bulk = JSON.parse(payload.deed_bulkStock)
    expect(bulk.find((b: { location: string }) => b.location === 'warehouse').qty).toBe(8)
  })

  it('returns 409-style error payload when stock is insufficient', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_products: [{ id: PRODUCT_ID, name: 'Widget', stockQty: 1, requiresSerial: false, unit: 'pcs' }],
      deed_serials: [],
      deed_bulkStock: [{ productId: PRODUCT_ID, location: 'warehouse', qty: 1 }],
      deed_stockMoves: [],
      deed_stockReservations: [],
    })

    const result = await applyDeliveryStockMutation({
      deliveryId: 'del-1',
      deliveryRef: 'DN/2026/0001',
      saleOrderId: 'so-1',
      lines: [{ productId: PRODUCT_ID, productName: 'Widget', qty: 5, sourceLocation: 'warehouse' }],
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/Insufficient stock/)
    }
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })
})

describe('reserveStockForSaleOrder()', () => {
  it('is idempotent when prisma reservations already exist', async () => {
    mockStockReservationFindMany.mockResolvedValue([{ id: 'existing' }])

    const result = await reserveStockForSaleOrder('so-1', 'user-1')

    expect(result).toEqual({ ok: true, reserved: 0, skipped: true })
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })

  it('creates blob reservations from prisma sale order lines', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_stockReservations: [],
      deed_products: [{ id: PRODUCT_ID, name: 'Widget', stockQty: 10, unit: 'pcs' }],
      deed_saleOrders: [],
    })
    mockSaleOrderFindUnique.mockResolvedValue({
      orderNumber: 'SO/2026/0009',
      items: [{ productId: PRODUCT_ID, description: 'Widget', qty: 3, serialNumberId: null }],
    })

    const result = await reserveStockForSaleOrder('so-1', 'user-1')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.reserved).toBe(3)
    expect(mockSaveStoreKeys).toHaveBeenCalled()
    const reservations = JSON.parse(mockSaveStoreKeys.mock.calls[0][0].deed_stockReservations)
    expect(reservations).toHaveLength(1)
    expect(reservations[0]).toMatchObject({
      productId: PRODUCT_ID,
      qty: 3,
      referenceId: 'so-1',
      status: 'reserved',
    })
  })
})

describe('applyReceiptStockMutation() — blob/Prisma product ID mismatch', () => {
  it('maps stock bump to the Prisma product matched by SKU', async () => {
    const blobId = PRODUCT_ID
    mockLoadAppState.mockResolvedValue({
      deed_products: [{ id: blobId, name: 'SanDisk Ultra 64GB SDXC Memory Card', sku: 'SANDISKU-N670N', stockQty: 0, requiresSerial: false }],
      deed_serials: [],
      deed_bulkStock: [],
      deed_stockMoves: [],
    })
    mockProductFindUnique.mockResolvedValue(null)
    mockProductFindFirst.mockResolvedValue({ id: PRISMA_PRODUCT_ID })
    mockStockLevelFindUnique.mockResolvedValue(null)

    const result = await applyReceiptStockMutation({
      receiptId: 'rec-1',
      receiptRef: 'REC/2026/0023',
      purchaseOrderId: 'po-1',
      destination: 'warehouse',
      lines: [{
        productId: blobId,
        productName: 'SanDisk Ultra 64GB SDXC Memory Card',
        qtyReceived: 2,
        requiresSerial: false,
      }],
      userId: 'user-1',
    })

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    expect(mockProductFindUnique).toHaveBeenCalled()
    // Either SKU lookup or create path must target the Prisma catalogue id
    const createArg = mockStockLevelCreate.mock.calls[0]?.[0]
    const updateArg = mockStockLevelUpdate.mock.calls[0]?.[0]
    const usedProductId = createArg?.data?.productId ?? updateArg?.where?.productId
    expect(usedProductId).toBe(PRISMA_PRODUCT_ID)
  })
})

describe('applyReceiptStockMutation() — atomic relational GRN', () => {
  const PO_ID = 'cccccccc-dddd-4eee-8fff-000000000000'
  const PO_ITEM_ID = 'dddddddd-eeee-4fff-8000-111111111111'

  it('bumps PurchaseOrderItem.qtyReceived and writes a GoodsReceivedNote/GrnItem inside one transaction', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_products: [{ id: PRODUCT_ID, name: 'Widget', stockQty: 0, requiresSerial: false }],
      deed_serials: [],
      deed_bulkStock: [],
      deed_stockMoves: [],
    })
    mockPurchaseOrderFindUnique.mockResolvedValue({
      id: PO_ID,
      items: [{ id: PO_ITEM_ID, productId: PRODUCT_ID, qtyOrdered: 10, qtyReceived: 2, unitCost: 100 }],
    })

    const result = await applyReceiptStockMutation({
      receiptId: 'rec-1',
      receiptRef: 'REC/2026/0001',
      purchaseOrderId: PO_ID,
      destination: 'warehouse',
      supplierInvoiceNo: 'INV-999',
      lines: [{ productId: PRODUCT_ID, productName: 'Widget', qtyReceived: 3, requiresSerial: false }],
      userId: 'user-1',
    })

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    expect(mockPurchaseOrderFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: PO_ID } }),
    )
    expect(mockGoodsReceivedNoteCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ poId: PO_ID, supplierInvoiceNo: 'INV-999' }) }),
    )
    expect(mockPurchaseOrderItemUpdate).toHaveBeenCalledWith({
      where: { id: PO_ITEM_ID },
      data: { qtyReceived: 5 },
    })
    expect(mockGrnItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ poItemId: PO_ITEM_ID, productId: PRODUCT_ID, qtyReceived: 3, unitCost: 100 }),
      }),
    )
    expect(mockPurchaseOrderUpdate).toHaveBeenCalledWith({
      where: { id: PO_ID },
      data: { status: 'partial' },
    })
  })

  it('clamps qtyReceived at qtyOrdered rather than overshooting', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_products: [{ id: PRODUCT_ID, name: 'Widget', stockQty: 0, requiresSerial: false }],
      deed_serials: [], deed_bulkStock: [], deed_stockMoves: [],
    })
    mockPurchaseOrderFindUnique.mockResolvedValue({
      id: PO_ID,
      items: [{ id: PO_ITEM_ID, productId: PRODUCT_ID, qtyOrdered: 5, qtyReceived: 4, unitCost: 100 }],
    })

    await applyReceiptStockMutation({
      receiptId: 'rec-1', receiptRef: 'REC/2026/0002', purchaseOrderId: PO_ID, destination: 'warehouse',
      lines: [{ productId: PRODUCT_ID, productName: 'Widget', qtyReceived: 3, requiresSerial: false }],
      userId: 'user-1',
    })

    expect(mockPurchaseOrderItemUpdate).toHaveBeenCalledWith({
      where: { id: PO_ITEM_ID },
      data: { qtyReceived: 5 },
    })
    expect(mockPurchaseOrderUpdate).toHaveBeenCalledWith({
      where: { id: PO_ID },
      data: { status: 'received' },
    })
  })

  it('best-effort mirrors received serials into the relational SerialNumber table', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_products: [{ id: PRODUCT_ID, name: 'Laptop', stockQty: 0, requiresSerial: true }],
      deed_serials: [], deed_bulkStock: [], deed_stockMoves: [],
    })
    mockPurchaseOrderFindUnique.mockResolvedValue({
      id: PO_ID,
      items: [{ id: PO_ITEM_ID, productId: PRODUCT_ID, qtyOrdered: 5, qtyReceived: 0, unitCost: 500 }],
    })

    const result = await applyReceiptStockMutation({
      receiptId: 'rec-1', receiptRef: 'REC/2026/0003', purchaseOrderId: PO_ID, destination: 'warehouse',
      lines: [{ productId: PRODUCT_ID, productName: 'Laptop', qtyReceived: 1, requiresSerial: true, serials: ['SN-1'] }],
      userId: 'user-1',
    })

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    expect(mockSerialNumberCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ serialNumber: 'SN-1', productId: PRODUCT_ID, purchaseItemId: 'grn-item-1' }),
      }),
    )
  })

  it('skips the relational GRN/PO-item bump when purchaseOrderId is missing but still bumps stock', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_products: [{ id: PRODUCT_ID, name: 'Widget', stockQty: 0, requiresSerial: false }],
      deed_serials: [], deed_bulkStock: [], deed_stockMoves: [],
    })

    const result = await applyReceiptStockMutation({
      receiptId: 'rec-1', receiptRef: 'REC/2026/0004', destination: 'warehouse',
      lines: [{ productId: PRODUCT_ID, productName: 'Widget', qtyReceived: 4, requiresSerial: false }],
      userId: 'user-1',
    })

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    expect(mockPurchaseOrderFindUnique).not.toHaveBeenCalled()
    expect(mockGoodsReceivedNoteCreate).not.toHaveBeenCalled()
    expect(mockStockLevelUpdate).toHaveBeenCalled()
    expect(mockSaveStoreKeys).toHaveBeenCalled()
  })

  it('creates a Prisma product from the catalogue when the GRN line is not linked yet', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_products: [{
        id: PRODUCT_ID,
        sku: 'LENOVOV1-H4IDD',
        name: 'Lenovo V14 G5 IRL long vendor title',
        stockQty: 0,
        requiresSerial: true,
        trackingMethod: 'SERIAL',
      }],
      deed_serials: [], deed_bulkStock: [], deed_stockMoves: [],
    })
    mockProductFindUnique.mockResolvedValue(null)
    mockProductFindFirst.mockResolvedValue(null)
    mockProductCreate.mockResolvedValue({ id: PRODUCT_ID, sku: 'LENOVOV1-H4IDD' })

    const result = await applyReceiptStockMutation({
      receiptId: 'rec-1', receiptRef: 'REC/2026/0083', destination: 'warehouse',
      lines: [{
        productId: PRODUCT_ID,
        productName: 'Lenovo V14 G5 IRL long vendor title',
        qtyReceived: 3,
        requiresSerial: true,
        serials: ['SN1', 'SN2', 'SN3'],
      }],
      userId: 'user-1',
    })

    expect(result.ok).toBe(true)
    expect(mockProductCreate).toHaveBeenCalled()
    expect(mockSaveStoreKeys).toHaveBeenCalled()
  })

  it('aborts before any blob write when a line has no catalogue product to link', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_products: [],
      deed_serials: [], deed_bulkStock: [], deed_stockMoves: [],
    })
    mockProductFindUnique.mockResolvedValue(null)
    mockProductFindFirst.mockResolvedValue(null)

    const result = await applyReceiptStockMutation({
      receiptId: 'rec-1', receiptRef: 'REC/2026/0005', destination: 'warehouse',
      lines: [{ productId: 'not-a-uuid', productName: 'Ghost Product', qtyReceived: 2, requiresSerial: false }],
      userId: 'user-1',
    })

    expect(result.ok).toBe(false)
    expect(mockProductCreate).not.toHaveBeenCalled()
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })

  it('reuses an existing GoodsReceivedNote instead of failing unique on retry', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_products: [{ id: PRODUCT_ID, name: 'Widget', stockQty: 0, requiresSerial: false }],
      deed_serials: [], deed_bulkStock: [], deed_stockMoves: [],
    })
    mockPurchaseOrderFindUnique.mockResolvedValue({
      id: PO_ID,
      items: [{ id: PO_ITEM_ID, productId: PRODUCT_ID, qtyOrdered: 10, qtyReceived: 5, unitCost: 100 }],
    })
    mockGoodsReceivedNoteFindUnique.mockResolvedValue({
      id: 'grn-existing',
      poId: PO_ID,
      items: [{ id: 'grn-item-existing', productId: PRODUCT_ID, qtyReceived: 3 }],
    })

    const result = await applyReceiptStockMutation({
      receiptId: 'rec-1', receiptRef: 'REC/2026/0001', purchaseOrderId: PO_ID, destination: 'warehouse',
      lines: [{ productId: PRODUCT_ID, productName: 'Widget', qtyReceived: 3, requiresSerial: false }],
      userId: 'user-1',
    })

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    expect(mockGoodsReceivedNoteCreate).not.toHaveBeenCalled()
    expect(mockPurchaseOrderItemUpdate).not.toHaveBeenCalled()
    expect(mockGrnItemCreate).not.toHaveBeenCalled()
    expect(mockStockLevelUpdate).not.toHaveBeenCalled()
    expect(mockSaveStoreKeys).toHaveBeenCalled()
  })

  it('does not double-apply blob stock when moves for this receipt already exist', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_products: [{ id: PRODUCT_ID, name: 'Widget', stockQty: 3, requiresSerial: false }],
      deed_serials: [],
      deed_bulkStock: [{ productId: PRODUCT_ID, location: 'warehouse', qty: 3 }],
      deed_stockMoves: [{
        id: 'move-1', type: 'in', productId: PRODUCT_ID, productName: 'Widget', qty: 3,
        reason: 'Receipt REC/2026/0001', documentRef: 'REC/2026/0001', serialNumbers: [],
        date: '2026-09-14', userId: 'user-1',
      }],
    })
    mockPurchaseOrderFindUnique.mockResolvedValue({
      id: PO_ID,
      items: [{ id: PO_ITEM_ID, productId: PRODUCT_ID, qtyOrdered: 10, qtyReceived: 3, unitCost: 100 }],
    })
    mockGoodsReceivedNoteFindUnique.mockResolvedValue({
      id: 'grn-existing',
      poId: PO_ID,
      items: [{ id: 'grn-item-existing', productId: PRODUCT_ID, qtyReceived: 3 }],
    })

    const result = await applyReceiptStockMutation({
      receiptId: 'rec-1', receiptRef: 'REC/2026/0001', purchaseOrderId: PO_ID, destination: 'warehouse',
      lines: [{ productId: PRODUCT_ID, productName: 'Widget', qtyReceived: 3, requiresSerial: false }],
      userId: 'user-1',
    })

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
    expect(mockGoodsReceivedNoteCreate).not.toHaveBeenCalled()
  })

  it('treats a unique-constraint race as the existing GRN', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_products: [{ id: PRODUCT_ID, name: 'Widget', stockQty: 0, requiresSerial: false }],
      deed_serials: [], deed_bulkStock: [], deed_stockMoves: [],
    })
    mockPurchaseOrderFindUnique.mockResolvedValue({
      id: PO_ID,
      items: [{ id: PO_ITEM_ID, productId: PRODUCT_ID, qtyOrdered: 10, qtyReceived: 0, unitCost: 100 }],
    })
    mockGoodsReceivedNoteFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'grn-raced',
        poId: PO_ID,
        items: [{ id: 'grn-item-raced', productId: PRODUCT_ID, qtyReceived: 3 }],
      })
    mockGoodsReceivedNoteCreate.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }))

    const result = await applyReceiptStockMutation({
      receiptId: 'rec-1', receiptRef: 'REC/2026/0001', purchaseOrderId: PO_ID, destination: 'warehouse',
      lines: [{ productId: PRODUCT_ID, productName: 'Widget', qtyReceived: 3, requiresSerial: false }],
      userId: 'user-1',
    })

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    expect(mockPurchaseOrderItemUpdate).not.toHaveBeenCalled()
    expect(mockGrnItemCreate).not.toHaveBeenCalled()
  })

  it('rolls back the relational GRN when reversing a failed valuation', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_products: [{ id: PRODUCT_ID, name: 'Widget', stockQty: 3, requiresSerial: false }],
      deed_serials: [],
      deed_bulkStock: [{ productId: PRODUCT_ID, location: 'warehouse', qty: 3 }],
      deed_stockMoves: [{ documentRef: 'REC/2026/0001', type: 'in', productId: PRODUCT_ID, qty: 3 }],
    })
    mockStockLevelFindUnique.mockResolvedValue({ qtyOnHand: 3, qtyReserved: 0 })
    mockGoodsReceivedNoteFindUnique.mockResolvedValue({
      id: 'grn-1',
      poId: PO_ID,
      items: [{ id: 'grn-item-1', poItemId: PO_ITEM_ID, productId: PRODUCT_ID, qtyReceived: 3 }],
    })
    mockPurchaseOrderItemFindUnique.mockResolvedValue({ id: PO_ITEM_ID, qtyReceived: 3 })
    mockPurchaseOrderItemFindMany.mockResolvedValue([{ id: PO_ITEM_ID, qtyReceived: 0, qtyOrdered: 10 }])

    await reverseReceiptStockMutation({
      receiptRef: 'REC/2026/0001',
      destination: 'warehouse',
      lines: [{ productId: PRODUCT_ID, qtyReceived: 3, requiresSerial: false }],
    })

    expect(mockSerialNumberUpdateMany).toHaveBeenCalledWith({
      where: { purchaseItemId: { in: ['grn-item-1'] } },
      data: { purchaseItemId: null },
    })
    expect(mockPurchaseOrderItemUpdate).toHaveBeenCalledWith({
      where: { id: PO_ITEM_ID },
      data: { qtyReceived: 0 },
    })
    expect(mockGoodsReceivedNoteDelete).toHaveBeenCalledWith({
      where: { id: 'grn-1' },
    })
    expect(mockPurchaseOrderUpdate).toHaveBeenCalledWith({
      where: { id: PO_ID },
      data: { status: 'confirmed' },
    })
  })
})


describe('applyPosStockMutation()', () => {
  it('deducts from warehouse even when client sends shop', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_products: [{ id: PRODUCT_ID, name: 'Adapter', stockQty: 5, requiresSerial: false, unit: 'pcs' }],
      deed_serials: [],
      deed_bulkStock: [
        { productId: PRODUCT_ID, location: 'warehouse', qty: 4 },
        { productId: PRODUCT_ID, location: 'shop', qty: 1 },
      ],
      deed_stockMoves: [],
    })

    const result = await applyPosStockMutation({
      orderRef: 'POS/2026/0001',
      lines: [{ productId: PRODUCT_ID, productName: 'Adapter', qty: 1, sourceLocation: 'shop' }],
      userId: 'user-1',
    })

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    const payload = mockSaveStoreKeys.mock.calls[0][0]
    const bulk = JSON.parse(payload.deed_bulkStock)
    expect(bulk.find((b: { location: string }) => b.location === 'warehouse').qty).toBe(3)
    expect(bulk.find((b: { location: string }) => b.location === 'shop').qty).toBe(1)
    const moves = JSON.parse(payload.deed_stockMoves)
    expect(moves[0].fromLocation).toBe('warehouse')
  })

  it('fails when warehouse is empty even if shop has stock', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_products: [{ id: PRODUCT_ID, name: 'Adapter', stockQty: 2, requiresSerial: false, unit: 'pcs' }],
      deed_serials: [],
      deed_bulkStock: [
        { productId: PRODUCT_ID, location: 'warehouse', qty: 0 },
        { productId: PRODUCT_ID, location: 'shop', qty: 2 },
      ],
      deed_stockMoves: [],
    })

    const result = await applyPosStockMutation({
      orderRef: 'POS/2026/0002',
      lines: [{ productId: PRODUCT_ID, productName: 'Adapter', qty: 1 }],
      userId: 'user-1',
    })

    expect(result).toEqual({
      ok: false,
      error: 'Insufficient stock for Adapter at warehouse',
    })
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })

  it('skips service / non-stock POS lines instead of requiring warehouse qty', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_products: [{
        id: PRODUCT_ID,
        name: 'On-site setup',
        stockQty: 0,
        requiresSerial: false,
        unit: 'service',
        productKind: 'service',
        trackStock: false,
      }],
      deed_serials: [],
      deed_bulkStock: [],
      deed_stockMoves: [],
    })

    const result = await applyPosStockMutation({
      orderRef: 'POS/2026/0003',
      lines: [{ productId: PRODUCT_ID, productName: 'On-site setup', qty: 1 }],
      userId: 'user-1',
    })

    expect(result).toEqual(expect.objectContaining({ ok: true }))
  })
})
