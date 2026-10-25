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

describe('return to stock after a checkout is closed', () => {
  const issue = async (serialIds: string[]) => {
    h.user = { id: 'u-tech', role: 'technical_lead', name: 'Tech' }
    const id = (await (await post({ action: 'request', productId: 'p-845', sourceLocation: 'warehouse', serialIds, receiverName: 'Brian', purpose: 'Other' })).json()).checkout.id
    h.user = { id: 'u-dir', role: 'director', name: 'Director' }
    await post({ action: 'approve', id })
    await post({ action: 'issue', id })
    return id
  }
  const serial = (id: string) => (h.state.deed_serials as any[]).find(s => s.id === id)
  const checkout = (id: string) => (h.state.deed_stockCheckouts as any[]).find(r => r.id === id)

  it('brings a unit closed as consumed back to its source, available again', async () => {
    const id = await issue(['s-free'])
    await post({ action: 'close', id, outcome: 'consumed', qty: 1, serialIds: ['s-free'] })
    expect(serial('s-free')).toMatchObject({ status: 'written_off' })
    const listed = (await (await GET())!.json()).checkouts.find((r: any) => r.id === id)
    expect(listed).toMatchObject({ status: 'completed', returnableSerialIds: ['s-free'], returnableQty: 1 })

    const res = await post({ action: 'return_closed', id, qty: 1, serialIds: ['s-free'], notes: 'Recorded as used by mistake' })
    expect(res.status).toBe(200)
    expect(serial('s-free')).toMatchObject({ location: 'warehouse', status: 'available' })
    expect(checkout(id)).toMatchObject({ status: 'completed', consumedQty: 0, returnedQty: 1 })
    expect((h.state.deed_products as any[])[0].stockQty).toBe(4)
    expect((h.state.deed_stockMoves as any[])[0]).toMatchObject({ type: 'return', toLocation: 'warehouse', serialNumbers: ['FREE1'] })
    // Nothing left to return.
    expect((await post({ action: 'return_closed', id, qty: 1, serialIds: ['s-free'] })).status).toBe(422)
  })

  it('brings an exception unit back from quarantine', async () => {
    const id = await issue(['s-free'])
    await post({ action: 'close', id, outcome: 'exception', qty: 1, serialIds: ['s-free'] })
    expect((await post({ action: 'return_closed', id, qty: 1, serialIds: ['s-free'] })).status).toBe(200)
    expect(serial('s-free')).toMatchObject({ location: 'warehouse', status: 'available' })
    expect(checkout(id)).toMatchObject({ exceptionQty: 0, returnedQty: 1 })
  })

  it('needs an approver role, and a closed checkout', async () => {
    const id = await issue(['s-free'])
    h.user = { id: 'u-fin', role: 'finance_officer', name: 'Fin' }
    expect((await post({ action: 'return_closed', id, qty: 1, serialIds: ['s-free'] })).status).toBe(403)
    h.user = { id: 'u-dir', role: 'director', name: 'Director' }
    expect((await post({ action: 'return_closed', id, qty: 1, serialIds: ['s-free'] })).status).toBe(409)
  })
})
