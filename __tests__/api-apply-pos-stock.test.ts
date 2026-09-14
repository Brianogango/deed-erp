import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetServerSession,
  mockApplyPosStockMutation,
  mockReversePosStockMutation,
  mockPostPosValuationFromPayload,
  mockReversePosValuationFromPayload,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockApplyPosStockMutation: vi.fn(),
  mockReversePosStockMutation: vi.fn(),
  mockPostPosValuationFromPayload: vi.fn(),
  mockReversePosValuationFromPayload: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({ getServerSession: mockGetServerSession }))
vi.mock('@/lib/inventory/stock-transactions', () => ({
  applyPosStockMutation: mockApplyPosStockMutation,
  reversePosStockMutation: mockReversePosStockMutation,
}))
vi.mock('@/lib/inventory/valuation-hooks', () => ({
  postPosValuationFromPayload: mockPostPosValuationFromPayload,
  reversePosValuationFromPayload: mockReversePosValuationFromPayload,
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
  mockReversePosStockMutation.mockResolvedValue(undefined)
  mockReversePosValuationFromPayload.mockResolvedValue({ ok: true })
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
    expect(mockReversePosStockMutation).not.toHaveBeenCalled()
  })

  it('reverses POS stock when valuation still fails closed', async () => {
    mockPostPosValuationFromPayload.mockResolvedValue({
      ok: false,
      reason: 'Insufficient FIFO layers for product prod-1: short 1',
    })
    const res = await POST(postReq(body))
    expect(res.status).toBe(422)
    expect(mockReversePosStockMutation).toHaveBeenCalled()
  })
})
