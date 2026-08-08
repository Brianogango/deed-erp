import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockVerifyQuoteToken, mockSendEmail, mockLoadAppState, mockSaveStoreKeys } = vi.hoisted(() => ({
  mockVerifyQuoteToken: vi.fn(),
  mockSendEmail: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
}))

vi.mock('@/lib/quote-token', () => ({ verifyQuoteToken: mockVerifyQuoteToken }))
vi.mock('@/lib/integrations/email', () => ({ sendEmail: mockSendEmail }))
vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  saveStoreKeys: mockSaveStoreKeys,
}))

import { POST as acceptRoute } from '@/app/api/portal/quotes/[id]/accept/route'
import { POST as rejectRoute } from '@/app/api/portal/quotes/[id]/reject/route'

const SO_ID = 'so-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockVerifyQuoteToken.mockReturnValue(true)
  mockSendEmail.mockResolvedValue({ success: true })
  mockSaveStoreKeys.mockResolvedValue(undefined)
})

function req(url: string, body?: unknown) {
  return new NextRequest(url, body !== undefined
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { method: 'POST' })
}

describe('POST /api/portal/quotes/[id]/accept — SaleOrder support', () => {
  it('records acceptance as a note without confirming the SaleOrder (no auto stock reservation)', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_quotes: [],
      deed_saleOrders: [{ id: SO_ID, ref: 'SO/2026/0001', status: 'quotation_sent', notes: '', customerName: 'Acme Ltd' }],
    })
    const res = await acceptRoute(req(`http://localhost/api/portal/quotes/${SO_ID}/accept?token=t`), { params: { id: SO_ID } })
    expect(res.status).toBe(200)
    const saved = mockSaveStoreKeys.mock.calls[0][0]
    const savedOrders = JSON.parse(saved.deed_saleOrders)
    // status must NOT have been silently promoted to 'sale' by a portal click.
    expect(savedOrders[0].status).toBe('quotation_sent')
    expect(savedOrders[0].notes).toContain('Customer accepted online')
    expect(savedOrders[0].acceptedAt).toBeTruthy()
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: expect.stringContaining('SO/2026/0001'),
    }))
  })

  it('rejects acceptance when the SaleOrder is already confirmed/cancelled', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_quotes: [],
      deed_saleOrders: [{ id: SO_ID, ref: 'SO/2026/0001', status: 'sale', notes: '' }],
    })
    const res = await acceptRoute(req(`http://localhost/api/portal/quotes/${SO_ID}/accept?token=t`), { params: { id: SO_ID } })
    expect(res.status).toBe(409)
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })

  it('rejects an invalid/expired token', async () => {
    mockVerifyQuoteToken.mockReturnValue(false)
    const res = await acceptRoute(req(`http://localhost/api/portal/quotes/${SO_ID}/accept?token=bad`), { params: { id: SO_ID } })
    expect(res.status).toBe(401)
  })
})

describe('POST /api/portal/quotes/[id]/reject — new path (previously absent for either document type)', () => {
  it('records a decline reason as a note without cancelling the SaleOrder', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_quotes: [],
      deed_saleOrders: [{ id: SO_ID, ref: 'SO/2026/0001', status: 'quotation_sent', notes: '', customerName: 'Acme Ltd' }],
    })
    const res = await rejectRoute(
      req(`http://localhost/api/portal/quotes/${SO_ID}/reject?token=t`, { reason: 'Too expensive' }),
      { params: { id: SO_ID } },
    )
    expect(res.status).toBe(200)
    const saved = mockSaveStoreKeys.mock.calls[0][0]
    const savedOrders = JSON.parse(saved.deed_saleOrders)
    expect(savedOrders[0].status).toBe('quotation_sent')
    expect(savedOrders[0].notes).toContain('Customer rejected online')
    expect(savedOrders[0].notes).toContain('Too expensive')
  })

  it('marks a CRM Quote as rejected', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_quotes: [{ id: 'quote-1', ref: 'QUO/0001', status: 'sent' }],
      deed_saleOrders: [],
    })
    const res = await rejectRoute(req('http://localhost/api/portal/quotes/quote-1/reject?token=t'), { params: { id: 'quote-1' } })
    expect(res.status).toBe(200)
    const saved = mockSaveStoreKeys.mock.calls[0][0]
    const savedQuotes = JSON.parse(saved.deed_quotes)
    expect(savedQuotes[0].status).toBe('rejected')
  })

  it('returns 404 for an unknown id', async () => {
    mockLoadAppState.mockResolvedValue({ deed_quotes: [], deed_saleOrders: [] })
    const res = await rejectRoute(req('http://localhost/api/portal/quotes/missing/reject?token=t'), { params: { id: 'missing' } })
    expect(res.status).toBe(404)
  })
})
