import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ state: {} as Record<string, any> }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/server', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u-inv', role: 'inventory_officer', name: 'Inv' } })) }))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: vi.fn(async () => undefined) }))
vi.mock('@/lib/server-store', () => {
  const read = async (keys: string[]) => Object.fromEntries(keys.map(k => [k, h.state[k]]))
  return {
    loadAppState: read,
    loadAppStateForWrite: read,
    saveStoreKeys: async (entries: Record<string, string>) => { for (const [k, v] of Object.entries(entries)) h.state[k] = JSON.parse(v) },
    withAppStateKeyLock: async (_k: string, fn: () => Promise<unknown>) => fn(),
  }
})

import { POST } from '@/app/api/inventory/computer-aid/route'

const post = async (body: unknown) => (await POST(new NextRequest('http://x/api/inventory/computer-aid', { method: 'POST', body: JSON.stringify(body) })))!

beforeEach(() => {
  h.state = {
    deed_products: [
      { id: 'p-lap', name: 'HP 840', sku: '840', requiresSerial: true, stockQty: 5 },
      { id: 'p-mouse', name: 'Mouse', sku: 'M1', requiresSerial: false, stockQty: 10 },
    ],
    deed_serials: [
      { id: 's1', serial: 'CA1', productId: 'p-lap', location: 'computer_aid', status: 'available' },
      { id: 's2', serial: 'WH1', productId: 'p-lap', location: 'warehouse', status: 'available' },
    ],
    deed_bulkStock: [{ productId: 'p-mouse', location: 'computer_aid', qty: 4 }],
    deed_stockMoves: [],
    deed_computerAidMovements: [],
  }
})

describe('Computer Aid → Warehouse', () => {
  it('moves serials back to the warehouse as available, sellable stock', async () => {
    const res = await post({ action: 'return', productId: 'p-lap', serialIds: ['s1'], date: '2026-11-05' })
    expect(res.status).toBe(200)
    expect(h.state.deed_serials.find((s: any) => s.id === 's1')).toMatchObject({ location: 'warehouse', status: 'available' })
    expect(h.state.deed_products.find((p: any) => p.id === 'p-lap').stockQty).toBe(6)
    expect(h.state.deed_stockMoves[0]).toMatchObject({ type: 'transfer', fromLocation: 'computer_aid', toLocation: 'warehouse', serialNumbers: ['CA1'] })
    expect(h.state.deed_computerAidMovements[0]).toMatchObject({ action: 'return', status: 'returned', qty: 1 })
  })

  it('moves quantities and refuses more than Computer Aid holds', async () => {
    expect((await post({ action: 'return', productId: 'p-mouse', qty: 5, date: '2026-11-05' })).status).toBe(409)
    expect((await post({ action: 'return', productId: 'p-mouse', qty: 3, date: '2026-11-05' })).status).toBe(200)
    const qtyAt = (loc: string) => h.state.deed_bulkStock.filter((b: any) => b.productId === 'p-mouse' && b.location === loc).reduce((s: number, b: any) => s + b.qty, 0)
    expect(qtyAt('computer_aid')).toBe(1)
    expect(qtyAt('warehouse')).toBe(3)
    expect(h.state.deed_products.find((p: any) => p.id === 'p-mouse').stockQty).toBe(13)
  })

  it('only takes serials that are at Computer Aid', async () => {
    expect((await post({ action: 'return', productId: 'p-lap', serialIds: ['s2'], date: '2026-11-05' })).status).toBe(409)
  })
})
