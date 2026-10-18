import { beforeEach, describe, expect, it, vi } from 'vitest'

const state: Record<string, unknown> = {}
const saved: Array<Record<string, string>> = []
const lockKeys: string[] = []

vi.mock('@/lib/server-store', () => ({
  loadAppState: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map(k => [k, structuredClone(state[k])]))),
  saveStoreKeys: vi.fn(async (entries: Record<string, string>) => {
    saved.push(entries)
    for (const [k, v] of Object.entries(entries)) state[k] = JSON.parse(v)
  }),
  notifyStoreKeysChanged: vi.fn(),
  withAppStateKeyLock: vi.fn(async (key: string, fn: () => Promise<unknown>) => { lockKeys.push(key); return fn() }),
}))
vi.mock('@/lib/prisma', () => ({ default: { $executeRaw: vi.fn(), $transaction: vi.fn(async () => undefined), product: { findMany: vi.fn(async () => []) } } }))

import { applyPosStockMutation } from '@/lib/inventory/stock-transactions'

beforeEach(() => {
  saved.length = 0
  lockKeys.length = 0
  state.deed_products = [{ id: 'p1', name: 'Mouse', requiresSerial: false, stockQty: 5 }]
  state.deed_serials = []
  state.deed_bulkStock = [{ productId: 'p1', location: 'warehouse', qty: 5 }]
  state.deed_stockMoves = []
})

describe('applyPosStockMutation', () => {
  const sale = { orderRef: 'POS/0100', lines: [{ productId: 'p1', productName: 'Mouse', qty: 2 }] }

  it('runs under the serial lock', async () => {
    await applyPosStockMutation(sale)
    expect(lockKeys).toEqual(['deed_serials'])
  })

  it('takes the stock once when the same sale is sent twice', async () => {
    const first = await applyPosStockMutation(sale)
    const second = await applyPosStockMutation(sale)
    expect(first.ok && first.alreadyApplied).toBeFalsy()
    expect(second.ok && second.alreadyApplied).toBe(true)
    expect(saved).toHaveLength(1)
    const level = (state.deed_bulkStock as Array<{ qty: number }>)[0]
    expect(level.qty).toBe(3)
  })

  it('still sells the same items again under a new ticket number', async () => {
    await applyPosStockMutation(sale)
    const next = await applyPosStockMutation({ ...sale, orderRef: 'POS/0101' })
    expect(next.ok && next.alreadyApplied).toBeFalsy()
    expect((state.deed_bulkStock as Array<{ qty: number }>)[0].qty).toBe(1)
  })
})
