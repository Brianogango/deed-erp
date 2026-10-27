import { describe, expect, it, vi, beforeEach } from 'vitest'
import { kilimallReturnPlan } from '@/lib/kilimall/kilimall-return'

const order = (over: Record<string, unknown> = {}) => ({
  id: 'ko-1', ref: 'KO/0012', kilimallRef: '6102', status: 'delivered', productId: 'p-ordered', productName: 'HP 830 G8',
  qty: 1, unitPrice: 40999, total: 40999, serialId: 's-1', serialNumber: 'SN1', dispatchId: 'd-1', ...over,
})
const meta = { by: 'Ann', at: '2026-10-27T10:00:00.000Z' }
const input = { condition: 'good' as const, outcome: 'refund' as const, reason: 'Changed mind' }

describe('kilimallReturnPlan', () => {
  it('refund: order ends as returned, device recorded', () => {
    const plan = kilimallReturnPlan(order(), input, meta)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.order.status).toBe('returned')
    expect(plan.order.returns).toHaveLength(1)
    expect(plan.entry).toMatchObject({ serialId: 's-1', serialNumber: 'SN1', productId: 'p-ordered', outcome: 'refund', by: 'Ann' })
    expect(plan.returnRef).toBe('KO/0012 return 1')
  })

  it('takes back the substitute that was actually shipped', () => {
    const plan = kilimallReturnPlan(order({ fulfilledProductId: 'p-sub', fulfilledProductName: 'ThinkPad 13' }), input, meta)
    expect(plan.ok && plan.productId).toBe('p-sub')
  })

  it('exchange: order goes back to pending without the returned device', () => {
    const plan = kilimallReturnPlan(order({ fulfilledProductId: 'p-sub' }), { ...input, outcome: 'exchange' }, meta)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.order.status).toBe('pending')
    expect(plan.order.serialId).toBeUndefined()
    expect(plan.order.dispatchId).toBeUndefined()
    expect(plan.order.fulfilledProductId).toBeUndefined()
    expect(plan.order.returns).toHaveLength(1)
  })

  it('notes a deduction to expect when Kilimall already paid the order', () => {
    const plan = kilimallReturnPlan(order({ settlementRef: 'KS/0003' }), input, meta)
    expect(plan.ok && plan.entry.paidInSettlementRef).toBe('KS/0003')
  })

  it('refuses orders not out with the customer, and incomplete input', () => {
    expect(kilimallReturnPlan(order({ status: 'pending' }), input, meta).ok).toBe(false)
    expect(kilimallReturnPlan(order({ status: 'returned' }), input, meta).ok).toBe(false)
    expect(kilimallReturnPlan(order(), { ...input, reason: ' ' }, meta).ok).toBe(false)
    expect(kilimallReturnPlan(order(), { ...input, condition: 'x' as any }, meta).ok).toBe(false)
  })

  it('numbers a second return after an exchange', () => {
    const first = kilimallReturnPlan(order(), { ...input, outcome: 'exchange' }, meta)
    if (!first.ok) throw new Error('first failed')
    const again = kilimallReturnPlan({ ...first.order, status: 'delivered', serialId: 's-2', serialNumber: 'SN2' }, input, meta)
    expect(again.ok && again.returnRef).toBe('KO/0012 return 2')
    expect(again.ok && again.order.returns).toHaveLength(2)
  })
})

const m = vi.hoisted(() => ({
  orders: [] as any[],
  saved: [] as any[],
  stock: vi.fn(),
  valuation: vi.fn(),
}))
vi.mock('@/lib/auth/api', () => ({
  requireRole: vi.fn(async () => ({ id: 'u1', name: 'Ann', username: 'ann', role: 'kilimall_officer' })),
  withApiErrorHandling: (fn: () => unknown) => fn(),
}))
vi.mock('@/lib/server-store', () => ({
  withAppStateKeyLock: (_k: string, fn: () => unknown) => fn(),
  loadAppStateForWrite: async () => ({ deed_kilimallOrders: m.orders }),
  saveStoreKeys: async (e: Record<string, string>) => { m.saved.push(e); m.orders = JSON.parse(e.deed_kilimallOrders) },
}))
vi.mock('@/lib/inventory/stock-transactions', () => ({ applyCustomerReturnStockMutation: m.stock }))
vi.mock('@/lib/inventory/valuation-hooks', () => ({ postCustomerReturnValuation: m.valuation }))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: vi.fn(async () => {}) }))

import { POST } from '@/app/api/kilimall/orders/[id]/return/route'

const call = (body: unknown) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as any, { params: Promise.resolve({ id: 'ko-1' }) })

describe('POST /api/kilimall/orders/[id]/return', () => {
  beforeEach(() => {
    m.orders = [order()]
    m.saved = []
    m.stock.mockReset().mockResolvedValue({ ok: true, moves: [] })
    m.valuation.mockReset().mockResolvedValue({ ok: true })
  })

  it('puts the shipped serial back and saves the returned order', async () => {
    const res = await call(input)
    expect(res.status).toBe(200)
    expect(m.stock).toHaveBeenCalledWith(expect.objectContaining({
      returnRef: 'KO/0012 return 1',
      lines: [expect.objectContaining({ productId: 'p-ordered', qty: 1, serialIds: ['s-1'] })],
    }))
    expect(m.valuation).toHaveBeenCalled()
    expect(m.orders[0].status).toBe('returned')
  })

  it('cannot return the same order twice', async () => {
    await call(input)
    const res = await call(input)
    expect(res.status).toBe(422)
    expect(m.stock).toHaveBeenCalledTimes(1)
  })

  it('leaves the order unchanged when the stock step fails', async () => {
    m.stock.mockResolvedValue({ ok: false, error: 'Serial missing' })
    const res = await call(input)
    expect(res.status).toBe(422)
    expect(m.saved).toHaveLength(0)
  })
})
