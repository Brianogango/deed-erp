import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { adjustStockLevel, createZeroStockLevel } from '@/lib/inventory/stock-level'
import { uuidFromKey } from '@/lib/accounting/ids'

const PRODUCT_ID = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee'

describe('adjustStockLevel()', () => {
  const findUnique = vi.fn()
  const update = vi.fn()
  const create = vi.fn()
  const tx = {
    stockLevel: { findUnique, update, create },
  } as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates an existing StockLevel row', async () => {
    findUnique.mockResolvedValue({ qtyOnHand: 10, qtyReserved: 2 })
    update.mockResolvedValue({})

    await adjustStockLevel(tx, PRODUCT_ID, { onHand: -3, reserved: 1 })

    expect(update).toHaveBeenCalledWith({
      where: { productId: PRODUCT_ID },
      data: { qtyOnHand: 7, qtyReserved: 3 },
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('creates a missing StockLevel instead of swallowing the gap', async () => {
    findUnique.mockResolvedValue(null)
    create.mockResolvedValue({})

    await adjustStockLevel(tx, PRODUCT_ID, { onHand: 5 })

    expect(create).toHaveBeenCalledWith({
      data: {
        id: uuidFromKey('stock_level', PRODUCT_ID),
        productId: PRODUCT_ID,
        qtyOnHand: 5,
        qtyReserved: 0,
      },
    })
  })

  it('rethrows when StockLevel create fails', async () => {
    findUnique.mockResolvedValue(null)
    create.mockRejectedValue(new Error('unique violation'))

    await expect(adjustStockLevel(tx, PRODUCT_ID, { onHand: 1 })).rejects.toThrow(/unique violation/)
  })
})

describe('createZeroStockLevel()', () => {
  it('inserts a zeroed StockLevel for a new product', async () => {
    const create = vi.fn().mockResolvedValue({})
    const tx = { stockLevel: { create } } as any

    await createZeroStockLevel(tx, PRODUCT_ID)

    expect(create).toHaveBeenCalledWith({
      data: {
        id: uuidFromKey('stock_level', PRODUCT_ID),
        productId: PRODUCT_ID,
        qtyOnHand: 0,
        qtyReserved: 0,
        qtyOnOrder: 0,
      },
    })
  })
})

describe('publishProduct StockLevel atomicity', () => {
  const mockFindFirst = vi.fn()
  const mockCategoryFind = vi.fn()
  const mockCategoryCreate = vi.fn()
  const mockProductCreate = vi.fn()
  const mockStockCreate = vi.fn()
  const mockTransaction = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockFindFirst.mockResolvedValue(null)
    mockCategoryFind.mockResolvedValue({ id: 'cat-1', name: 'Laptops' })
    mockProductCreate.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: PRODUCT_ID, ...data }),
    )
    mockStockCreate.mockResolvedValue({})
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        product: { create: mockProductCreate },
        stockLevel: { create: mockStockCreate },
      }),
    )
  })

  it('creates Product + StockLevel in one transaction', async () => {
    vi.doMock('@/lib/prisma', () => ({
      default: {
        product: { findFirst: mockFindFirst },
        category: { findFirst: mockCategoryFind, create: mockCategoryCreate },
        $transaction: mockTransaction,
      },
    }))

    const { publishProduct } = await import('@/lib/product-catalog-write')
    const result = await publishProduct({
      name: 'HP ProBook',
      category: 'Laptops',
      salePrice: 1000,
      costPrice: 800,
      minStock: 2,
      productKind: 'storable',
      trackStock: true,
      isActive: true,
    } as any)

    expect(result.status).toBe('created')
    expect(mockTransaction).toHaveBeenCalled()
    expect(mockProductCreate).toHaveBeenCalled()
    expect(mockStockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productId: PRODUCT_ID,
        qtyOnHand: 0,
        qtyReserved: 0,
        qtyOnOrder: 0,
      }),
    })
  })
})

describe('migration 20260805_stocklevel_indexes_safe.sql', () => {
  const sql = readFileSync(
    join(process.cwd(), 'database/migrations/20260805_stocklevel_indexes_safe.sql'),
    'utf8',
  )

  it('is idempotent (IF NOT EXISTS / NOT EXISTS / conditional CHECK)', () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_invoices_client_status/)
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_invoices_status_date/)
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_repairs_status_created/)
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_sale_orders_client_status/)
    expect(sql).toMatch(/WHERE NOT EXISTS \(\s*SELECT 1 FROM stock_levels/)
    expect(sql).toMatch(/chk_sale_orders_status/)
    expect(sql).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/)
  })

  it('backfill id matches uuidFromKey for a sample product', () => {
    // SQL formula: 4 + substr(h,14,3) and a + substr(h,18,3) — same as uuidFromKey
    const { createHash } = require('crypto') as typeof import('crypto')
    const h = createHash('md5').update(`stock_level:${PRODUCT_ID}`).digest('hex')
    const fromSql =
      `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
    expect(fromSql).toBe(uuidFromKey('stock_level', PRODUCT_ID))
    expect(sql).toContain("md5('stock_level:' || p.id::text)")
  })
})
