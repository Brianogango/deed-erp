import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetServerSession,
  mockApplyPosStockMutation,
  mockPostPosValuationFromPayload,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockApplyPosStockMutation: vi.fn(),
  mockPostPosValuationFromPayload: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({ getServerSession: mockGetServerSession }))
vi.mock('@/lib/inventory/stock-transactions', () => ({
  applyPosStockMutation: mockApplyPosStockMutation,
}))
vi.mock('@/lib/inventory/valuation-hooks', () => ({
  postPosValuationFromPayload: mockPostPosValuationFromPayload,
}))

import { POST } from '@/app/api/inventory/apply-pos-stock/route'

const session = { user: { id: 'user-1', role: 'sales_rep' } }
const body = {
  orderRef: 'POS/0100',
  lines: [{ productId: 'prod-1', productName: 'Mouse', qty: 1, sourceLocation: 'warehouse' }],
}

function postReq(payload: unknown) {
  return new NextRequest('http://localhost/api/inventory/apply-pos-stock', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetServerSession.mockResolvedValue(session)
  mockApplyPosStockMutation.mockResolvedValue({ ok: true, moves: [{ id: 'm1' }] })
  mockPostPosValuationFromPayload.mockResolvedValue({ ok: true, warnings: [] })
})

describe('POST /api/inventory/apply-pos-stock', () => {
  it('keeps the stock deduction when COGS only warns about finance setup', async () => {
    mockPostPosValuationFromPayload.mockResolvedValue({
      ok: true,
      warnings: ['prod-1: Unknown journal code: STK'],
    })
    const res = await POST(postReq(body))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.valuation.warnings).toEqual(['prod-1: Unknown journal code: STK'])
  })

  it('keeps the stock deduction when valuation fails closed', async () => {
    mockPostPosValuationFromPayload.mockResolvedValue({
      ok: false,
      reason: 'Insufficient FIFO layers for product prod-1: short 1',
    })
    const res = await POST(postReq(body))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.valuation.ok).toBe(false)
  })

  it('keeps the stock deduction when valuation throws', async () => {
    mockPostPosValuationFromPayload.mockRejectedValue(new Error('Fiscal period 2026 is closed'))
    const res = await POST(postReq(body))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.valuation.ok).toBe(false)
  })
})
