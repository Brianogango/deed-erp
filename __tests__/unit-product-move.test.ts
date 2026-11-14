import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ state: {} as Record<string, any>, saved: vi.fn(), bump: vi.fn(), valuation: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/server-store', () => ({ loadAppStateForWrite: async () => h.state, saveStoreKeys: h.saved }))
vi.mock('@/lib/inventory/stock-transactions', () => ({ bumpPrismaOnHand: h.bump }))
vi.mock('@/lib/inventory/valuation-hooks', () => ({ postAdjustmentValuation: h.valuation }))

import { unitMoveBlocker } from '@/lib/inventory/unit-product-move'
import { moveSerialToProduct } from '@/lib/inventory/unit-product-move.server'

const wrong = { id: 'p-g5', name: 'HP 840 G5 i5/8/256', stockQty: 3, requiresSerial: true }
const right = { id: 'p-g6', name: 'HP 840 G6 i5/16/512', sku: 'G6-16', stockQty: 1, requiresSerial: true }
const unit = { id: 's1', serial: 'SN123', productId: 'p-g5', productName: wrong.name, status: 'available', location: 'warehouse', assetId: 'LT000124' }

beforeEach(() => {
  vi.clearAllMocks()
  h.state = { deed_products: [wrong, right, { id: 'p-qty', name: 'Mouse', stockQty: 9 }], deed_serials: [unit], deed_stockMoves: [] }
  h.valuation.mockImplementation(async (p: any) => (p.type === 'subtract' ? { result: { totalCost: 32000 } } : { ok: true }))
})

describe('unitMoveBlocker', () => {
  it('only a machine in stock moves', () => {
    expect(unitMoveBlocker(unit)).toBeNull()
    expect(unitMoveBlocker({ ...unit, status: 'sold' })).toMatch(/sold/)
    expect(unitMoveBlocker({ ...unit, saleOrderId: 'so-1' })).toMatch(/sale order/)
    expect(unitMoveBlocker({ ...unit, repairId: 'r-1' })).toMatch(/repair/)
    expect(unitMoveBlocker({ ...unit, identityPending: true })).toMatch(/Identify/)
  })
})

describe('moveSerialToProduct', () => {
  it('moves the machine, its count and its cost; keeps serial and asset ID', async () => {
    const r = await moveSerialToProduct({ userId: 'u1', serialId: 's1', productId: 'p-g6', reason: 'Received under the wrong specs', specs: 'i5-8365U 16GB 512GB' })
    expect(r).toMatchObject({ ok: true, fromProductName: wrong.name, cost: 32000 })
    const saved = h.saved.mock.calls[0][0]
    const serial = JSON.parse(saved.deed_serials)[0]
    expect(serial).toMatchObject({ id: 's1', serial: 'SN123', assetId: 'LT000124', productId: 'p-g6', productName: right.name, sku: 'G6-16', specs: 'i5-8365U 16GB 512GB' })
    const products = JSON.parse(saved.deed_products)
    expect(products.find((p: any) => p.id === 'p-g5').stockQty).toBe(2)
    expect(products.find((p: any) => p.id === 'p-g6').stockQty).toBe(2)
    expect(JSON.parse(saved.deed_stockMoves)[0].reason).toMatch(/Corrected: SN123 moved from HP 840 G5.*to HP 840 G6.*wrong specs/)
    expect(h.bump).toHaveBeenCalledWith(new Map([['p-g5', -1], ['p-g6', 1]]))
    expect(h.valuation).toHaveBeenNthCalledWith(1, expect.objectContaining({ productId: 'p-g5', type: 'subtract', qty: 1 }))
    expect(h.valuation).toHaveBeenNthCalledWith(2, expect.objectContaining({ productId: 'p-g6', type: 'add', qty: 1, unitCost: 32000 }))
  })

  it('refuses a machine that is not in stock, a counted product, or no reason', async () => {
    h.state.deed_serials = [{ ...unit, saleOrderId: 'so-1' }]
    expect(await moveSerialToProduct({ userId: 'u1', serialId: 's1', productId: 'p-g6', reason: 'wrong specs' })).toMatchObject({ ok: false, status: 409 })
    h.state.deed_serials = [unit]
    expect(await moveSerialToProduct({ userId: 'u1', serialId: 's1', productId: 'p-qty', reason: 'wrong specs' })).toMatchObject({ ok: false, status: 422 })
    expect(await moveSerialToProduct({ userId: 'u1', serialId: 's1', productId: 'p-g6', reason: '' })).toMatchObject({ ok: false, status: 422 })
    expect(h.saved).not.toHaveBeenCalled()
    expect(h.valuation).not.toHaveBeenCalled()
  })
})
