import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockRequireRole,
  mockCheckFiscalLock,
  mockPostPosSale,
  mockWriteFinancialAuditInTx,
  mockPrisma,
} = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockCheckFiscalLock: vi.fn(),
  mockPostPosSale: vi.fn(),
  mockWriteFinancialAuditInTx: vi.fn(),
  mockPrisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ id: 'tx' })),
    accountCode: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/auth/api', () => ({
  withApiErrorHandling: async (handler: () => Promise<unknown>) => handler(),
  requireRole: mockRequireRole,
}))

vi.mock('@/lib/fiscal-lock.server', () => ({ checkFiscalLock: mockCheckFiscalLock }))
vi.mock('@/lib/accounting/posting-service', () => ({ postPosSale: mockPostPosSale }))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAuditInTx: mockWriteFinancialAuditInTx }))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))

import { POST } from '@/app/api/pos/post-sale-journal/route'

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/pos/post-sale-journal', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const saleBody = {
  orderId: 'pos-1',
  orderRef: 'POS/0099',
  total: 1160,
  subtotal: 1000,
  tax: 160,
  paymentMethod: 'cash',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireRole.mockResolvedValue({ id: 'u1', role: 'sales_rep' })
  mockCheckFiscalLock.mockResolvedValue({ ok: true })
  mockPostPosSale.mockResolvedValue({ id: 'je-1', ref: 'JRN/POS/0099' })
  mockWriteFinancialAuditInTx.mockResolvedValue(undefined)
  mockPrisma.accountCode.findMany.mockImplementation(async ({ where }: any) =>
    [
      { code: '5000', accountType: 'revenue', isActive: true },
      { code: '5010', accountType: 'revenue', isActive: true },
      { code: '1000', accountType: 'asset', isActive: true },
    ].filter(a => where.code.in.includes(a.code)))
})

describe('POST /api/pos/post-sale-journal', () => {
  it('defaults a missing posting date to today instead of 422', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const res = await POST(postReq(saleBody))
    expect(res.status).toBe(200)
    expect(mockCheckFiscalLock).toHaveBeenCalledWith(expect.any(Date))
    expect(mockPostPosSale).toHaveBeenCalledWith(
      expect.objectContaining({
        orderRef: 'POS/0099',
        date: today,
      }),
    )
  })

  it('still rejects an invalid posting date', async () => {
    const res = await POST(postReq({ ...saleBody, date: 'not-a-date' }))
    expect(res.status).toBe(422)
    expect(mockPostPosSale).not.toHaveBeenCalled()
  })

  it('posts when finance supplies an explicit date', async () => {
    mockRequireRole.mockResolvedValue({ id: 'u2', role: 'finance_officer' })
    const res = await POST(postReq({ ...saleBody, date: '2026-09-13' }))
    expect(res.status).toBe(200)
    expect(mockPostPosSale).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-09-13' }),
    )
  })

  it('refuses a backdated POS journal from a till role', async () => {
    const res = await POST(postReq({ ...saleBody, date: '2026-09-13' }))
    expect(res.status).toBe(422)
    expect(mockPostPosSale).not.toHaveBeenCalled()
  })

  it('refuses revenue lines that credit a non-revenue account (e.g. writing off cash)', async () => {
    const res = await POST(postReq({
      orderId: 'x', orderRef: 'POS-X', total: 0, subtotal: 50000, tax: 0, pointsRedeemed: 50000,
      revenueLines: [{ account: '1000 - Cash', amount: 50000 }],
    }))
    expect(res.status).toBe(422)
    expect(mockPostPosSale).not.toHaveBeenCalled()
  })

  it('refuses loyalty redemption larger than the sale', async () => {
    const res = await POST(postReq({ ...saleBody, pointsRedeemed: 5000 }))
    expect(res.status).toBe(422)
    expect(mockPostPosSale).not.toHaveBeenCalled()
  })

  it('refuses revenue lines that do not add up to the subtotal', async () => {
    const res = await POST(postReq({ ...saleBody, revenueLines: [{ account: '5000 - Sales Revenue', amount: 400 }] }))
    expect(res.status).toBe(422)
  })

  it('posts a normal sale split across revenue accounts', async () => {
    const res = await POST(postReq({ ...saleBody, revenueLines: [
      { account: '5000 - Sales Revenue', amount: 600 },
      { account: '5010 - Accessories', amount: 400 },
    ] }))
    expect(res.status).toBe(200)
    expect(mockPostPosSale).toHaveBeenCalledOnce()
  })
})
