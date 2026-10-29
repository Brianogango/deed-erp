import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ stock: vi.fn(), valuation: vi.fn(), audit: vi.fn() }))
vi.mock('@/lib/auth/api', () => ({
  requireRole: vi.fn(async () => ({ id: 'u1', name: 'Lead', role: 'technical_lead' })),
  withApiErrorHandling: (fn: () => unknown) => fn(),
}))
vi.mock('@/lib/server-store', () => ({ withAppStateKeyLock: (_k: string, fn: () => unknown) => fn() }))
vi.mock('@/lib/inventory/stock-transactions', () => ({ applySerialWriteOffMutation: m.stock }))
vi.mock('@/lib/inventory/valuation-hooks', () => ({ postAdjustmentValuation: m.valuation }))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: m.audit }))

import { POST } from '@/app/api/inventory/serial-write-off/route'

const call = (body: unknown) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as any)

beforeEach(() => {
  m.stock.mockReset().mockResolvedValue({ ok: true, productId: 'p1', productName: 'HP 840', serial: 'SN1' })
  m.valuation.mockReset().mockResolvedValue({ ok: true, result: { totalCost: 18250.5 } })
  m.audit.mockReset().mockResolvedValue(undefined)
})

describe('POST /api/inventory/serial-write-off', () => {
  it('write-off: unit out of stock and its cost booked as a write-off', async () => {
    const res = await call({ serialId: 's1', action: 'write_off', reference: 'REF/0105', reason: 'Board dead' })
    expect(res.status).toBe(200)
    expect(m.stock).toHaveBeenCalledWith(expect.objectContaining({ serialId: 's1', action: 'write_off', adjustOnHand: true }))
    expect(m.valuation).toHaveBeenCalledWith(expect.objectContaining({ productId: 'p1', type: 'subtract', qty: 1 }))
    expect((await res.json()).cost).toBe(18250.5)
  })

  it('restore: the same cost goes back into inventory against the write-off expense', async () => {
    const res = await call({ serialId: 's1', action: 'restore', reference: 'REF/0105', reason: 'Fixed after all', unitCost: 18250.5 })
    expect(res.status).toBe(200)
    expect(m.stock).toHaveBeenCalledWith(expect.objectContaining({ action: 'restore', adjustOnHand: true }))
    expect(m.valuation).toHaveBeenCalledWith(expect.objectContaining({ type: 'add', qty: 1, unitCost: 18250.5, reversesWriteOff: true }))
  })

  it('restore of an older write-off (nothing was booked): status only, no value added back', async () => {
    const res = await call({ serialId: 's1', action: 'restore', reference: 'REF/0001', reason: 'Back' })
    expect(res.status).toBe(200)
    expect(m.stock).toHaveBeenCalledWith(expect.objectContaining({ action: 'restore', adjustOnHand: false }))
    expect(m.valuation).not.toHaveBeenCalled()
  })

  it('refuses when the stock step refuses (already written off, sold…)', async () => {
    m.stock.mockResolvedValue({ ok: false, error: 'SN1 is already written off', status: 409 })
    const res = await call({ serialId: 's1', action: 'write_off', reference: 'REF/0105', reason: 'x' })
    expect(res.status).toBe(409)
    expect(m.valuation).not.toHaveBeenCalled()
  })

  it('needs a reason', async () => {
    expect((await call({ serialId: 's1', action: 'write_off' })).status).toBe(422)
  })
})
