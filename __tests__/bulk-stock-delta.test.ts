import { describe, expect, it, vi } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    $executeRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings.join('?'), values })),
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))

import { applyBulkStockDeltas, diffBulkStock, isBulkStockDeltaList } from '@/lib/inventory/bulk-stock-delta'
import { applyBulkStockDeltasToTable } from '@/lib/inventory/bulk-stock-delta.server'
import { rememberServerBaseline } from '@/lib/store-baseline'
import { buildSyncBody } from '@/lib/store/sync'

const row = (productId: string, location: string, qty: number) => ({ productId, location, qty })

describe('quantity stock saved as changes', () => {
  it('a writer\'s change is the difference from what it loaded', () => {
    const base = [row('cover', 'warehouse', 3), row('tape', 'shop', 2)]
    const next = [row('cover', 'warehouse', 2), row('tape', 'shop', 2), row('hub', 'warehouse', 1)]
    expect(diffBulkStock(base, next)).toEqual(expect.arrayContaining([
      { productId: 'cover', location: 'warehouse', delta: -1 },
      { productId: 'hub', location: 'warehouse', delta: 1 },
    ]))
    expect(diffBulkStock(base, next)).toHaveLength(2)
  })

  it('a row dropped at zero is a removal of its quantity', () => {
    expect(diffBulkStock([row('cover', 'warehouse', 2)], [])).toEqual([{ productId: 'cover', location: 'warehouse', delta: -2 }])
  })

  it('two writers from the same starting list both count (a sale and a receipt at once)', () => {
    const stored = [row('cover', 'warehouse', 5)]
    const sale = diffBulkStock(stored, [row('cover', 'warehouse', 4)])
    const receipt = diffBulkStock(stored, [row('cover', 'warehouse', 8)])
    // Saving whole lists, the later save would leave 8 (the sale lost) or 4.
    const after = applyBulkStockDeltas(applyBulkStockDeltas(stored, sale), receipt)
    expect(after).toEqual([row('cover', 'warehouse', 7)])
  })

  it('a phone that loaded before a receipt keeps the received stock (REC/2026/0369)', () => {
    const phoneLoaded: ReturnType<typeof row>[] = [row('tape', 'warehouse', 4)]
    // Meanwhile a receipt added 16 accessories on the server.
    const server = [row('tape', 'warehouse', 4), ...Array.from({ length: 16 }, (_, i) => row(`acc${i}`, 'warehouse', 1))]
    // The phone sells one tape.
    const phoneChange = diffBulkStock(phoneLoaded, [row('tape', 'warehouse', 3)])
    const after = applyBulkStockDeltas(server, phoneChange)
    expect(after).toHaveLength(17)
    expect(after.find(r => r.productId === 'tape')?.qty).toBe(3)
  })

  it('never goes below zero', () => {
    expect(applyBulkStockDeltas([row('cover', 'warehouse', 1)], [{ productId: 'cover', location: 'warehouse', delta: -3 }])).toEqual([])
  })

  it('accepts only well-formed change lists', () => {
    expect(isBulkStockDeltaList([{ productId: 'p', location: 'warehouse', delta: 2 }])).toBe(true)
    expect(isBulkStockDeltaList([{ productId: '', location: 'warehouse', delta: 2 }])).toBe(false)
    expect(isBulkStockDeltaList([{ productId: 'p', location: 'warehouse', delta: 1.5 }])).toBe(false)
    expect(isBulkStockDeltaList({ productId: 'p' })).toBe(false)
  })

  it('the table adds each change to the stored quantity, never sets it', async () => {
    mockPrisma.$executeRaw.mockClear()
    const n = await applyBulkStockDeltasToTable([
      { productId: 'cover', location: 'warehouse', delta: -1 },
      { productId: 'hub', location: 'warehouse', delta: 0 },
    ])
    expect(n).toBe(1)
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1)
    const [strings] = mockPrisma.$executeRaw.mock.calls[0] as unknown as [TemplateStringsArray]
    expect(strings.join('?')).toMatch(/GREATEST\(0, stock_location_levels\.qty \+ \?\)/)
  })

  it('a browser that knows the server copy sends its changes, not its list', () => {
    rememberServerBaseline('deed_bulkStock', JSON.stringify([row('cover', 'warehouse', 5)]))
    const { body, deltaKeys } = buildSyncBody({ deed_bulkStock: JSON.stringify([row('cover', 'warehouse', 4)]) })
    expect(body.deed_bulkStock).toBeUndefined()
    expect(body._bulkStockDelta).toEqual([{ productId: 'cover', location: 'warehouse', delta: -1 }])
    expect(deltaKeys).toContain('deed_bulkStock')
  })
})
