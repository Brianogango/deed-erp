import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrismaTransaction = vi.fn()
const mockBulkStockLevelFindUnique = vi.fn()
const mockBulkStockLevelUpdate = vi.fn()
const mockBulkStockLevelCreate = vi.fn()
const mockStockMovementCreate = vi.fn()

vi.mock('@/lib/server-store', () => ({
  loadAppState: vi.fn(),
  saveStoreKeys: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => mockPrismaTransaction(fn),
  },
}))

import { applyBulkStockPlanToPrisma } from '@/lib/reconfiguration/service'

const PRODUCT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const WORK_ORDER_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'

beforeEach(() => {
  vi.clearAllMocks()
  mockPrismaTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      bulkStockLevel: {
        findUnique: mockBulkStockLevelFindUnique,
        update: mockBulkStockLevelUpdate,
        create: mockBulkStockLevelCreate,
      },
      stockMovement: { create: mockStockMovementCreate },
    }),
  )
  mockBulkStockLevelUpdate.mockResolvedValue({})
  mockBulkStockLevelCreate.mockResolvedValue({})
  mockStockMovementCreate.mockResolvedValue({ id: 'move-1' })
})

describe('applyBulkStockPlanToPrisma', () => {
  // Regression: device reconfiguration's remove/install stock moves used to
  // write ONLY to the deed_bulkStock / deed_stockMoves JSON blobs, with no
  // durable relational record at all. This pins that a remove/install now
  // authoritatively creates/updates bulk_stock_levels + stock_movements.
  it('creates a new bulk_stock_levels row and a reconfiguration_in movement when none exists yet', async () => {
    mockBulkStockLevelFindUnique.mockResolvedValue(null)
    const moveId = await applyBulkStockPlanToPrisma(
      {
        kind: 'return_bulk_to_testing',
        productId: PRODUCT_ID,
        qty: 1,
        reason: 'Removed during RCF/2026/0002',
        to: 'pending_testing',
        documentRef: 'RCF/2026/0002',
      },
      { unitCost: 1500, workOrderId: WORK_ORDER_ID, userId: 'user-1', blobId: 'sm_123_abc' },
    )
    expect(moveId).toBe('move-1')
    expect(mockBulkStockLevelCreate).toHaveBeenCalledWith({
      data: { productId: PRODUCT_ID, location: 'pending_testing', qty: 1 },
    })
    expect(mockStockMovementCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productId: PRODUCT_ID,
        movementType: 'reconfiguration_in',
        qty: 1,
        qtyBefore: 0,
        qtyAfter: 1,
        toLocation: 'pending_testing',
        fromLocation: null,
        referenceType: 'reconfiguration_work_order',
        referenceId: WORK_ORDER_ID,
        documentRef: 'RCF/2026/0002',
        blobId: 'sm_123_abc',
        createdById: 'user-1',
      }),
    })
  })

  it('increments an existing bulk_stock_levels row on a removal return', async () => {
    mockBulkStockLevelFindUnique.mockResolvedValue({ id: 'bsl-1', qty: 3 })
    await applyBulkStockPlanToPrisma(
      { kind: 'return_bulk_to_testing', productId: PRODUCT_ID, qty: 2, reason: 'Removed during RCF/2026/0002', to: 'quarantine' },
      { unitCost: 0 },
    )
    expect(mockBulkStockLevelUpdate).toHaveBeenCalledWith({ where: { id: 'bsl-1' }, data: { qty: 5 } })
  })

  it('decrements an existing bulk_stock_levels row on an install consumption', async () => {
    mockBulkStockLevelFindUnique.mockResolvedValue({ id: 'bsl-2', qty: 5 })
    const moveId = await applyBulkStockPlanToPrisma(
      { kind: 'consume_bulk', productId: PRODUCT_ID, qty: 2, reason: 'Installed during RCF/2026/0002', from: 'warehouse' },
      { unitCost: 800, workOrderId: WORK_ORDER_ID },
    )
    expect(moveId).toBe('move-1')
    expect(mockBulkStockLevelUpdate).toHaveBeenCalledWith({ where: { id: 'bsl-2' }, data: { qty: 3 } })
    expect(mockStockMovementCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        movementType: 'reconfiguration_out',
        qtyBefore: 5,
        qtyAfter: 3,
        fromLocation: 'warehouse',
        toLocation: null,
      }),
    })
  })

  it('rejects a consumption that would exceed the relational bulk stock level, not the blob', async () => {
    mockBulkStockLevelFindUnique.mockResolvedValue({ id: 'bsl-3', qty: 1 })
    await expect(
      applyBulkStockPlanToPrisma(
        { kind: 'consume_bulk', productId: PRODUCT_ID, qty: 2, reason: 'Installed during RCF/2026/0002', from: 'warehouse' },
        { unitCost: 0 },
      ),
    ).rejects.toThrow(/Insufficient stock at warehouse/)
    expect(mockBulkStockLevelUpdate).not.toHaveBeenCalled()
    expect(mockStockMovementCreate).not.toHaveBeenCalled()
  })

  it('never lets qtyAfter go negative when consuming exactly the available quantity', async () => {
    mockBulkStockLevelFindUnique.mockResolvedValue({ id: 'bsl-4', qty: 2 })
    await applyBulkStockPlanToPrisma(
      { kind: 'consume_bulk', productId: PRODUCT_ID, qty: 2, reason: 'Installed during RCF/2026/0003', from: 'warehouse' },
      { unitCost: 0 },
    )
    expect(mockBulkStockLevelUpdate).toHaveBeenCalledWith({ where: { id: 'bsl-4' }, data: { qty: 0 } })
  })
})
