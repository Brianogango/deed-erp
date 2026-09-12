/**
 * Repair parts consumption posts Dr 6301 / Cr 1200 at moving-average cost —
 * previously parts dropped out of stock with no GL entry at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    product: { findUnique: vi.fn() },
    productValuation: { findUnique: vi.fn(), upsert: vi.fn() },
    valuationEvent: { findUnique: vi.fn(), create: vi.fn() },
    inventoryLedgerEntry: { upsert: vi.fn() },
    stockMovement: { update: vi.fn() },
    accountCode: { findUnique: vi.fn() },
    journal: { findUnique: vi.fn() },
    journalEntry: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    fiscalLock: { findFirst: vi.fn() },
    fiscalPeriod: { findFirst: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('@/lib/server-store', () => ({
  loadAppState: vi.fn().mockResolvedValue({ deed_systemSettings: null, deed_products: [] }),
  saveStoreKeys: vi.fn(),
}))

import { processStockRepairConsume } from '@/lib/inventory/valuation-service'

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.product.findUnique.mockResolvedValue({ id: 'prod-1', trackStock: true })
  mockPrisma.productValuation.findUnique.mockResolvedValue({ totalQty: 10, totalValue: 5000, averageCost: 500 })
  mockPrisma.productValuation.upsert.mockResolvedValue({})
  mockPrisma.valuationEvent.findUnique.mockResolvedValue(null)
  mockPrisma.valuationEvent.create.mockResolvedValue({})
  mockPrisma.inventoryLedgerEntry.upsert.mockResolvedValue({})
  mockPrisma.accountCode.findUnique.mockImplementation(({ where }: any) =>
    Promise.resolve({ id: `acct-${where.code}`, isActive: true }))
  mockPrisma.journal.findUnique.mockResolvedValue({ id: 'jnl-stk' })
  mockPrisma.journalEntry.findUnique.mockResolvedValue(null)
  mockPrisma.journalEntry.findFirst.mockResolvedValue(null)
  mockPrisma.journalEntry.create.mockResolvedValue({ id: 'je-1' })
  mockPrisma.fiscalLock.findFirst.mockResolvedValue(null)
  mockPrisma.fiscalPeriod.findFirst.mockResolvedValue({ state: 'open' })
})

describe('processStockRepairConsume', () => {
  it('posts Dr 6301 repair costs / Cr 1200 inventory at average cost', async () => {
    const result = await processStockRepairConsume({ productId: 'prod-1', qty: 2, reference: 'REP/0001' })
    expect(result.skipped).toBeFalsy()
    expect(mockPrisma.journalEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceType: 'stock_repair',
          lines: expect.objectContaining({
            create: expect.arrayContaining([
              expect.objectContaining({ accountLabel: expect.stringContaining('6301'), debit: 1000 }),
              expect.objectContaining({ accountLabel: expect.stringContaining('1200'), credit: 1000 }),
            ]),
          }),
        }),
      }),
    )
  })

  it('is idempotent per repair + product', async () => {
    mockPrisma.valuationEvent.findUnique.mockResolvedValue({ id: 'evt-1' })
    const result = await processStockRepairConsume({ productId: 'prod-1', qty: 2, reference: 'REP/0001' })
    expect(result.skipped).toBe(true)
    expect(mockPrisma.journalEntry.create).not.toHaveBeenCalled()
  })

  it('reduces the product valuation like any outbound move', async () => {
    await processStockRepairConsume({ productId: 'prod-1', qty: 2, reference: 'REP/0001' })
    expect(mockPrisma.productValuation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ totalQty: 8, totalValue: 4000 }),
      }),
    )
  })
})
