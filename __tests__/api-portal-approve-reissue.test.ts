import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  lookupRepair: vi.fn(),
  loadAppState: vi.fn(),
  saveStoreKeys: vi.fn(),
  publish: vi.fn(),
  prisma: {
    client: { findFirst: vi.fn(), create: vi.fn() },
    user: { findFirst: vi.fn() },
    saleOrder: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    invoice: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  },
}))

vi.mock('@/lib/portal-repair-server', () => ({ lookupRepair: h.lookupRepair }))
vi.mock('@/lib/server-store', () => ({
  loadAppState: h.loadAppState,
  loadAppStateForWrite: h.loadAppState,
  saveStoreKeys: h.saveStoreKeys,
  withAppStateKeyLock: (_key: string, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true, remaining: 10, resetAt: Date.now() + 60_000 }) }))
vi.mock('@/lib/prisma', () => ({ default: h.prisma }))
vi.mock('@/lib/doc-ref-counter', () => ({ getNextDocNumber: vi.fn().mockResolvedValue('X/1') }))
vi.mock('@/lib/portal-repairs', () => ({ approvalDecisions: new Map() }))
vi.mock('@/lib/contact-prisma', () => ({ findExistingContact: vi.fn().mockResolvedValue({ id: 'c-1' }) }))
vi.mock('@/lib/notifications/service', () => ({ publishNotificationEvent: h.publish }))

import { POST } from '@/app/api/portal/repair/[ref]/approve/route'

const INV = '11111111-1111-4111-8111-111111111111'
const base = {
  id: 'rep-1', ref: 'REP/2026/0001', status: 'awaiting_approval', customerPhone: '0712345678', customerName: 'Ada', productName: 'Laptop',
  invoiceId: INV, linkedInvoiceId: INV,
  quote: { lines: [{ id: 'l1', description: 'Screen', qty: 1, unitPrice: 13000, subtotal: 13000, type: 'labor' }], subtotal: 13000, tax: 0, total: 13000 },
}
const approve = (approved: boolean) => POST(new NextRequest('http://localhost/api/portal/repair/REP%2F2026%2F0001/approve', {
  method: 'POST',
  body: JSON.stringify({ approved, verifyPhone: '0712345678' }),
  headers: { 'Content-Type': 'application/json' },
}), { params: Promise.resolve({ ref: 'REP/2026/0001' }) })
const savedRepair = () => {
  const call = h.saveStoreKeys.mock.calls.find(c => c[0].deed_repairs_v2)
  return JSON.parse(call![0].deed_repairs_v2)[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  h.lookupRepair.mockResolvedValue(base)
  h.prisma.user.findFirst.mockResolvedValue({ id: 'sys' })
  h.publish.mockResolvedValue(undefined)
  h.saveStoreKeys.mockResolvedValue(undefined)
})

const withRepair = (over: Record<string, unknown>) => h.loadAppState.mockResolvedValue({
  deed_systemSettings: {}, deed_invoices: [], deed_repairs_v2: [{ ...base, ...over }],
})

describe('a client approving a revised quote on an invoiced job', () => {
  it('never rewrites a posted invoice — it goes to Finance to reissue', async () => {
    withRepair({ invoiceReissue: { status: 'awaiting_client', invoiceId: INV, invoiceRef: 'INV/2026/0042', previousTotal: 10000, revisedTotal: 13000, raisedAt: '2026-09-29' } })
    h.prisma.invoice.findUnique.mockResolvedValue({ id: INV, invoiceNumber: 'INV/2026/0042', totalAmount: 10000, postingStatus: 'posted', postedJournalEntryId: 'j-1' })
    expect((await approve(true)).status).toBe(200)
    expect(h.prisma.invoice.update).not.toHaveBeenCalled()
    expect(h.prisma.saleOrder.update).not.toHaveBeenCalled()
    expect(savedRepair().invoiceReissue).toMatchObject({ status: 'pending' })
    expect(h.publish.mock.calls[0][0]).toMatchObject({ roles: ['finance_officer', 'director'] })
  })

  it('raises the reissue itself for a job revised before the rule existed', async () => {
    withRepair({})
    h.prisma.invoice.findUnique.mockResolvedValue({ id: INV, invoiceNumber: 'INV/2026/0042', totalAmount: 10000, postingStatus: 'posted', postedJournalEntryId: 'j-1' })
    await approve(true)
    expect(h.prisma.invoice.update).not.toHaveBeenCalled()
    expect(savedRepair().invoiceReissue).toMatchObject({ status: 'pending', previousTotal: 10000, revisedTotal: 13000 })
  })

  it('still updates an invoice that never reached the ledger', async () => {
    withRepair({})
    h.prisma.invoice.findUnique.mockResolvedValue({ id: INV, invoiceNumber: 'INV/2026/0042', totalAmount: 10000, postingStatus: 'unposted', postedJournalEntryId: null, amountPaid: 0 })
    h.prisma.saleOrder.create.mockResolvedValue({ id: 'so-1', orderNumber: 'SO/1' })
    h.prisma.invoice.update.mockResolvedValue({ id: INV, invoiceNumber: 'INV/2026/0042' })
    await approve(true)
    expect(h.prisma.invoice.update).toHaveBeenCalled()
    expect(savedRepair().invoiceReissue).toBeUndefined()
  })

  it('drops the reissue when the invoice never reached the ledger and was updated in place', async () => {
    withRepair({ invoiceReissue: { status: 'awaiting_client', invoiceId: INV, invoiceRef: 'INV/2026/0042', previousTotal: 10000, revisedTotal: 13000, raisedAt: '2026-09-29' } })
    h.prisma.invoice.findUnique.mockResolvedValue({ id: INV, invoiceNumber: 'INV/2026/0042', totalAmount: 10000, postingStatus: 'unposted', postedJournalEntryId: null, amountPaid: 0 })
    h.prisma.saleOrder.create.mockResolvedValue({ id: 'so-1', orderNumber: 'SO/1' })
    h.prisma.invoice.update.mockResolvedValue({ id: INV, invoiceNumber: 'INV/2026/0042' })
    await approve(true)
    expect(h.prisma.invoice.update).toHaveBeenCalled()
    expect(savedRepair().invoiceReissue).toMatchObject({ status: 'dropped' })
    expect(h.publish).not.toHaveBeenCalled()
  })

  it('a decline leaves the posted invoice standing', async () => {
    withRepair({ invoiceReissue: { status: 'awaiting_client', invoiceId: INV, invoiceRef: 'INV/2026/0042', previousTotal: 10000, revisedTotal: 13000, raisedAt: '2026-09-29' } })
    h.prisma.invoice.findUnique.mockResolvedValue({ id: INV, invoiceNumber: 'INV/2026/0042', totalAmount: 10000, postingStatus: 'posted', postedJournalEntryId: 'j-1' })
    await approve(false)
    expect(savedRepair().invoiceReissue).toMatchObject({ status: 'dropped' })
    expect(h.publish).not.toHaveBeenCalled()
  })
})
