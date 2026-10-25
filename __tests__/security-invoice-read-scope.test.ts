import { describe, it, expect, vi, beforeEach } from 'vitest'

// Invoice REST reads follow the same per-role slices as /api/store
// (invoiceSliceForRole). Real lib/auth/api and authorization run.
const m = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  findUnique: vi.fn(),
  buildInvoiceStats: vi.fn(),
  listSends: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/server', () => ({ getServerSession: m.getServerSession }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/prisma', () => ({
  default: {
    invoice: { findMany: m.findMany, count: m.count, findUnique: m.findUnique },
    paymentAllocation: { findMany: vi.fn(async () => []) },
    auditLog: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/accounting/invoice-stats.server', () => ({ buildInvoiceStats: m.buildInvoiceStats, nairobiToday: () => '2026-10-25' }))
vi.mock('@/lib/document-email-sends', () => ({ listDocumentEmailSends: m.listSends }))
vi.mock('@/lib/auth/users-repository', () => ({ listAuthUsers: vi.fn(async () => []) }))
vi.mock('@/lib/http-metrics', () => ({ recordHttpMetric: vi.fn() }))

import { GET as listInvoices } from '@/app/api/invoices/route'
import { GET as getInvoice } from '@/app/api/invoices/[id]/route'
import { GET as invoiceHistory } from '@/app/api/invoices/[id]/history/route'
import { GET as invoiceStats } from '@/app/api/invoices/stats/route'
import { GET as emailSends } from '@/app/api/document-email-sends/route'
import { NextRequest } from 'next/server'

const session = (role: string) => ({ user: { id: 'u1', name: 'U', username: 'u', role, modules: ['repair', 'sales', 'accounting'] } })
const ID = '11111111-1111-4111-8111-111111111111'
const params = { params: Promise.resolve({ id: ID }) }
const bill = { id: ID, invoiceNumber: 'BILL/1', documentType: 'vendor_bill', repairId: null, totalAmount: 1, createdAt: new Date(), createdById: 'x', postedAt: null, postedById: null, items: [] }

beforeEach(() => {
  vi.clearAllMocks()
  m.findMany.mockResolvedValue([])
  m.count.mockResolvedValue(0)
  m.findUnique.mockResolvedValue(bill)
  m.buildInvoiceStats.mockResolvedValue({ revenue: 1 })
  m.listSends.mockResolvedValue([{ id: 's1', to: 'vendor@example.com' }])
})

describe('GET /api/invoices', () => {
  it('limits a technician to repair invoices', async () => {
    m.getServerSession.mockResolvedValue(session('technician'))
    await listInvoices(new Request('http://x/api/invoices'))
    expect(m.findMany.mock.calls[0][0].where).toMatchObject({ AND: [{ repairId: { not: null } }] })
    expect(m.count.mock.calls[0][0].where).toMatchObject({ AND: [{ repairId: { not: null } }] })
  })

  it('limits a sales rep to customer invoices', async () => {
    m.getServerSession.mockResolvedValue(session('sales_rep'))
    await listInvoices(new Request('http://x/api/invoices?status=posted'))
    expect(m.findMany.mock.calls[0][0].where).toMatchObject({ AND: [{ documentType: 'customer_invoice' }] })
  })

  it('returns nothing to a role without an invoice slice', async () => {
    m.getServerSession.mockResolvedValue(session('hr_manager'))
    await listInvoices(new Request('http://x/api/invoices'))
    expect(m.findMany.mock.calls[0][0].where).toMatchObject({ id: { in: [] } })
  })

  it('finance sees the whole ledger', async () => {
    m.getServerSession.mockResolvedValue(session('finance_officer'))
    await listInvoices(new Request('http://x/api/invoices'))
    expect(m.findMany.mock.calls[0][0].where).toEqual({})
  })
})

describe('single invoice, history, stats and email log', () => {
  it('a sales rep cannot open a vendor bill or its history', async () => {
    m.getServerSession.mockResolvedValue(session('sales_rep'))
    expect((await getInvoice(new Request('http://x'), params)).status).toBe(404)
    expect((await invoiceHistory(new Request('http://x'), params)).status).toBe(404)
  })

  it('finance can open the bill', async () => {
    m.getServerSession.mockResolvedValue(session('finance_officer'))
    expect((await getInvoice(new Request('http://x'), params)).status).toBe(200)
  })

  it('ledger-wide stats are refused to slice roles', async () => {
    m.getServerSession.mockResolvedValue(session('technician'))
    expect((await invoiceStats(new NextRequest('http://x/api/invoices/stats'))).status).toBe(403)
    expect(m.buildInvoiceStats).not.toHaveBeenCalled()
    m.getServerSession.mockResolvedValue(session('director'))
    expect((await invoiceStats(new NextRequest('http://x/api/invoices/stats'))).status).toBe(200)
  })

  it('the email log is not readable in bulk, or for a bill outside the slice', async () => {
    m.getServerSession.mockResolvedValue(session('sales_rep'))
    expect((await (await emailSends(new Request('http://x/api/document-email-sends'))).json()).sends).toEqual([])
    expect((await (await emailSends(new Request(`http://x/api/document-email-sends?documentId=${ID}&documentType=bill`))).json()).sends).toEqual([])
    expect(m.listSends).not.toHaveBeenCalled()
    // A quote's own history stays available.
    expect((await (await emailSends(new Request('http://x/api/document-email-sends?documentId=q1&documentType=quote'))).json()).sends).toHaveLength(1)
  })
})
