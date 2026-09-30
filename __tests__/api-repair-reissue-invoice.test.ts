import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  prisma: {
    invoice: { findUnique: vi.fn(), update: vi.fn() },
    creditNoteLine: { groupBy: vi.fn() },
    product: { findMany: vi.fn() },
    saleOrder: { update: vi.fn() },
  },
  requireRole: vi.fn(),
  createCreditNote: vi.fn(),
  loadAppState: vi.fn(),
  loadAppStateForWrite: vi.fn(),
  saveStoreKeys: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ default: h.prisma }))
vi.mock('@/lib/auth/api', () => ({
  requireRole: h.requireRole,
  withApiErrorHandling: async (fn: () => Promise<Response>) => {
    try { return await fn() } catch (err: any) {
      return new Response(JSON.stringify({ error: err?.message }), { status: err?.status ?? 500 })
    }
  },
}))
vi.mock('@/lib/doc-ref-counter', () => ({ getNextDocNumber: vi.fn().mockResolvedValue('CN/2026/0007') }))
vi.mock('@/lib/accounting/credit-note-service', () => ({ createCustomerCreditNote: h.createCreditNote }))
vi.mock('@/lib/server-store', () => ({
  loadAppState: h.loadAppState,
  loadAppStateForWrite: h.loadAppStateForWrite,
  saveStoreKeys: h.saveStoreKeys,
  withAppStateKeyLock: async (_k: string, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('@/lib/documents-broadcast.server', () => ({ refreshInvoicesBlob: vi.fn(), refreshSaleOrdersBlob: vi.fn() }))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: vi.fn().mockResolvedValue(undefined) }))

import { POST } from '@/app/api/repairs/[id]/reissue-invoice/route'

const INV = '11111111-1111-4111-8111-111111111111'
const SO = '22222222-2222-4222-8222-222222222222'
const repair = (over: Record<string, unknown> = {}) => ({
  id: 'rep-1', ref: 'REP/2026/0101', customerName: 'Jane', saleOrderId: SO, invoiceId: INV, linkedInvoiceId: INV,
  quote: { approvedDate: '2026-09-30', subtotal: 12500, tax: 2000, lines: [{ description: 'Screen', qty: 1, unitPrice: 12500 }] },
  invoiceReissue: { status: 'pending', invoiceId: INV, invoiceRef: 'INV/2026/0042', previousTotal: 11600, revisedTotal: 14500, raisedAt: '2026-09-29' },
  ...over,
})
const postedInvoice = {
  id: INV, invoiceNumber: 'INV/2026/0042', clientId: 'c-1', client: { name: 'Jane' }, saleOrderId: SO,
  postingStatus: 'posted', postedJournalEntryId: 'j-1', totalAmount: 11600, amountPaid: 11600,
  items: [{ id: 'it-1', qty: 1 }],
}
const call = () => POST(new NextRequest('http://localhost/api/repairs/rep-1/reissue-invoice', { method: 'POST' }), { params: Promise.resolve({ id: 'rep-1' }) })

let saved: Record<string, string> = {}
beforeEach(() => {
  vi.clearAllMocks()
  saved = {}
  h.requireRole.mockResolvedValue({ id: 'u-fin', name: 'Faith', role: 'finance_officer' })
  h.loadAppState.mockResolvedValue({ deed_repairs_v2: [repair()] })
  h.loadAppStateForWrite.mockImplementation(async (keys: string[]) => keys.includes('deed_repairs_v2') ? { deed_repairs_v2: [repair()] } : { deed_customerCredits: [] })
  h.saveStoreKeys.mockImplementation(async (v: Record<string, string>) => { Object.assign(saved, v) })
  h.prisma.invoice.findUnique.mockResolvedValue(postedInvoice)
  h.prisma.creditNoteLine.groupBy.mockResolvedValue([])
  h.prisma.product.findMany.mockResolvedValue([])
  h.createCreditNote.mockResolvedValue({ ref: 'CN/2026/0007', customerCredit: 11600 })
})

describe('Finance reissuing a re-quoted repair invoice', () => {
  it('credits the old invoice in full and frees the repair to be billed afresh', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(h.createCreditNote.mock.calls[0][0]).toMatchObject({ invoiceId: INV, lines: [{ invoiceItemId: 'it-1', qty: 1 }] })
    const saleOrder = h.prisma.saleOrder.update.mock.calls[0][0]
    expect(saleOrder.where.id).toBe(SO)
    expect(saleOrder.data).toMatchObject({ status: 'sale', subtotal: 12500 })
    const stored = JSON.parse(saved.deed_repairs_v2)[0]
    expect(stored.invoiceId).toBeUndefined()
    expect(stored.previousInvoiceIds).toEqual([INV])
    expect(stored.invoiceReissue).toMatchObject({ status: 'credited', creditNoteRef: 'CN/2026/0007', customerCredit: 11600, creditedBy: 'Faith' })
  })

  it('keeps what the client paid as their credit, to apply to the new invoice', async () => {
    await call()
    const credits = JSON.parse(saved.deed_customerCredits)
    expect(credits[0]).toMatchObject({ customerId: 'c-1', amount: 11600, balance: 11600, status: 'available', sourceInvoiceRef: 'INV/2026/0042' })
  })

  it('cancels, rather than credits, an invoice that never reached the ledger', async () => {
    h.prisma.invoice.findUnique.mockResolvedValue({ ...postedInvoice, postingStatus: 'unposted', postedJournalEntryId: null, amountPaid: 0 })
    expect((await call()).status).toBe(200)
    expect(h.createCreditNote).not.toHaveBeenCalled()
    expect(h.prisma.invoice.update).toHaveBeenCalledWith({ where: { id: INV }, data: { status: 'cancelled' } })
  })

  it('does nothing until the client has approved the revision', async () => {
    h.loadAppState.mockResolvedValue({ deed_repairs_v2: [repair({ invoiceReissue: { ...repair().invoiceReissue, status: 'awaiting_client' } })] })
    expect((await call()).status).toBe(409)
    expect(h.createCreditNote).not.toHaveBeenCalled()
  })

  it('is Finance and directors only', async () => {
    h.requireRole.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }))
    expect((await call()).status).toBe(403)
  })
})
