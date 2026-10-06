import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  user: { id: 'u-tech', role: 'technical_lead', name: 'Tech' },
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/server', () => ({ getServerSession: vi.fn(async () => ({ user: h.user })) }))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: vi.fn(async () => undefined) }))
vi.mock('@/lib/notifications/business-events', () => ({ notifyStockCheckout: vi.fn(async () => undefined) }))
vi.mock('@/lib/server-store', () => {
  const read = async (keys: string[]) => Object.fromEntries(keys.map(k => [k, h.state[k]]))
  return {
    loadAppState: read,
    loadAppStateForWrite: read,
    saveStoreKeys: async (entries: Record<string, string>) => {
      for (const [k, v] of Object.entries(entries)) h.state[k] = JSON.parse(v)
    },
    withAppStateKeyLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  }
})

import { GET, POST } from '@/app/api/inventory/stock-checkouts/route'

const post = async (body: unknown) => (await POST(new NextRequest('http://x/api/inventory/stock-checkouts', { method: 'POST', body: JSON.stringify(body) })))!

beforeEach(() => {
  h.user = { id: 'u-tech', role: 'technical_lead', name: 'Tech' }
  h.state = {
    deed_products: [{ id: 'p-845', name: 'HP EliteBook 845 G7', sku: '845', requiresSerial: true, stockQty: 4 }],
    deed_serials: [
      { id: 's-free', serial: 'FREE1', productId: 'p-845', location: 'warehouse', status: 'available' },
      { id: 's-held', serial: 'HELD1', productId: 'p-845', location: 'warehouse', status: 'assigned', saleOrderId: 'so-dlight' },
      { id: 's-inbound', serial: 'INB1', productId: 'p-845', location: 'pending_testing', status: 'available' },
      { id: 's-ca', serial: 'CA1', productId: 'p-845', location: 'computer_aid', status: 'available' },
      { id: 's-sold', serial: 'SOLD1', productId: 'p-845', location: 'warehouse', status: 'sold' },
      { id: 's-cust', serial: 'CUST1', productId: 'p-845', location: 'customer', status: 'assigned' },
    ],
    deed_bulkStock: [],
    deed_stockMoves: [],
    deed_stockCheckouts: [],
    deed_saleOrders: [{ id: 'so-dlight', ref: 'SO/2026/0004', customerName: 'D.Light' }],
  }
})

describe('stock checkout source stock', () => {
  it('lists every in-house unit, including units held for orders and Inbound / Computer Aid stock', async () => {
    const res = (await GET())!
    const body = await res.json()
    const bySerial = Object.fromEntries(body.serials.map((s: any) => [s.serial, s]))
    expect(Object.keys(bySerial).sort()).toEqual(['CA1', 'FREE1', 'HELD1', 'INB1'])
    expect(bySerial.HELD1.heldFor).toBe('SO/2026/0004 · D.Light')
    expect(bySerial.FREE1.heldFor).toBeUndefined()
  })

  it('checks out a held unit and returns it still held for its order', async () => {
    let res = await post({ action: 'request', productId: 'p-845', sourceLocation: 'warehouse', serialIds: ['s-held'], receiverName: 'Derrick', purpose: 'demo' })
    expect(res.status).toBe(200)
    const id = (await res.json()).checkout.id
    h.user = { id: 'u-dir', role: 'director', name: 'Director' }
    expect((await post({ action: 'approve', id })).status).toBe(200)
    expect((await post({ action: 'issue', id })).status).toBe(200)
    expect((h.state.deed_serials as any[]).find(s => s.id === 's-held')).toMatchObject({ location: 'employee', saleOrderId: 'so-dlight' })
    expect((await post({ action: 'close', id, outcome: 'returned', qty: 1, serialIds: ['s-held'] })).status).toBe(200)
    expect((h.state.deed_serials as any[]).find(s => s.id === 's-held')).toMatchObject({ location: 'warehouse', status: 'assigned', saleOrderId: 'so-dlight' })
  })

  it('checks out from Inbound, refuses sold units', async () => {
    expect((await post({ action: 'request', productId: 'p-845', sourceLocation: 'pending_testing', serialIds: ['s-inbound'], receiverName: 'Lab', purpose: 'testing' })).status).toBe(200)
    expect((await post({ action: 'request', productId: 'p-845', sourceLocation: 'warehouse', serialIds: ['s-sold'], receiverName: 'Lab', purpose: 'testing' })).status).toBe(409)
  })
})
