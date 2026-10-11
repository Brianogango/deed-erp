import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  stockMovement: { findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  product: { findMany: vi.fn() },
  serialNumber: { findMany: vi.fn() },
  receiptDocument: { findMany: vi.fn() },
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ default: prismaMock }))
vi.mock('@/lib/auth/db', () => ({ sql: vi.fn(async () => ({ rows: [] })) }))
vi.mock('@/lib/prisma-store', () => ({ writeStoreRecords: vi.fn(), storeBackend: () => 'prisma' }))

import { mirrorKnownDomain } from '@/lib/blob-transfer'
import { loadScreenReceipts, loadScreenStockMoves } from '@/lib/stock-read-model.server'

const move = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'in', productId: 'p', productName: 'X', qty: 1, documentRef: 'REC/2026/0001', ...extra })

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.product.findMany.mockResolvedValue([])
  prismaMock.stockMovement.updateMany.mockResolvedValue({ count: 1 })
})

describe('stock moves taken off the list', () => {
  it('are marked removed in the table (a reversed receipt)', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => move(`m${i}`))
    prismaMock.stockMovement.findMany.mockResolvedValue(rows.map(r => ({ blobId: r.id, screenExtras: r, removedAt: null })))
    await mirrorKnownDomain('deed_stockMoves', JSON.stringify(rows.slice(1)), null)
    expect(prismaMock.stockMovement.updateMany).toHaveBeenCalledWith({ where: { blobId: { in: ['m0'] } }, data: { removedAt: expect.any(Date) } })
  })

  it('a partial list removes nothing', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => move(`m${i}`))
    prismaMock.stockMovement.findMany.mockResolvedValue(rows.map(r => ({ blobId: r.id, screenExtras: r, removedAt: null })))
    await mirrorKnownDomain('deed_stockMoves', JSON.stringify(rows.slice(0, 5)), null)
    expect(prismaMock.stockMovement.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: { removedAt: expect.any(Date) } }))
  })

  it('a removed move listed again is restored', async () => {
    const m = move('m1')
    prismaMock.stockMovement.findMany.mockResolvedValue([{ blobId: 'm1', screenExtras: m, removedAt: new Date() }])
    await mirrorKnownDomain('deed_stockMoves', JSON.stringify([m]), null)
    expect(prismaMock.stockMovement.updateMany).toHaveBeenCalledWith({ where: { blobId: 'm1' }, data: expect.objectContaining({ removedAt: null }) })
  })

  it('are not shown, and the frozen copy does not bring them back', async () => {
    prismaMock.stockMovement.findMany.mockResolvedValue([
      { blobId: 'm1', screenExtras: move('m1'), removedAt: null },
      { blobId: 'm2', screenExtras: move('m2'), removedAt: new Date() },
    ])
    const out = await loadScreenStockMoves([move('m1'), move('m2'), move('m3')])
    expect(out.map(m => m.id)).toEqual(['m1', 'm3'])
  })
})

describe('receipts removed from the list', () => {
  it('do not come back from the frozen copy', async () => {
    prismaMock.receiptDocument.findMany.mockResolvedValue([
      { id: 'r1', record: { id: 'r1', ref: 'REC/1' }, removedAt: null },
      { id: 'r2', record: { id: 'r2', ref: 'REC/2' }, removedAt: new Date() },
    ])
    const out = await loadScreenReceipts([{ id: 'r2' }, { id: 'r3' }])
    expect(out.map(r => r.id)).toEqual(['r1', 'r3'])
  })
})
