import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockLoadAppState = vi.fn()
const mockSaveStoreKeys = vi.fn()
const mockPrismaTransaction = vi.fn()
const mockStockLevelFindUnique = vi.fn()
const mockStockLevelUpdate = vi.fn()
const mockStockLevelCreate = vi.fn()
const mockStockReservationFindMany = vi.fn()
const mockSaleOrderFindUnique = vi.fn()
const mockMirrorReservations = vi.fn()

vi.mock('@/lib/server-store', () => ({
  loadAppState: (...args: unknown[]) => mockLoadAppState(...args),
  saveStoreKeys: (...args: unknown[]) => mockSaveStoreKeys(...args),
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
    stockReservation: {
      findMany: (...args: unknown[]) => mockStockReservationFindMany(...args),
    },
    saleOrder: {
      findUnique: (...args: unknown[]) => mockSaleOrderFindUnique(...args),
    },
  },
}))

import { applyDeliveryStockMutation, reserveStockForSaleOrder } from '@/lib/inventory/stock-transactions'

const PRODUCT_ID = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee'

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
    })
  })
  mockStockLevelFindUnique.mockResolvedValue({ qtyOnHand: 20, qtyReserved: 0 })
  mockStockLevelUpdate.mockResolvedValue({})
  mockStockLevelCreate.mockResolvedValue({})
  mockStockReservationFindMany.mockResolvedValue([])
  mockMirrorReservations.mockResolvedValue({ mirrored: 1, skipped: 0, failed: 0 })
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
