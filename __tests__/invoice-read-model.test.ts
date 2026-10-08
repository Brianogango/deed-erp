import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: { invoice: { findMany: vi.fn() }, user: { findMany: vi.fn() } },
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))

import { loadScreenInvoices } from '@/lib/invoice-read-model.server'

const row = (over: Record<string, unknown> = {}) => ({
  id: 'inv-1', invoiceNumber: 'INV/2026/0001', documentType: 'customer_invoice', clientId: 'c-1', status: 'approved',
  client: { name: 'Acme' }, items: [], payments: [], paymentAllocations: [],
  invoiceDate: new Date('2026-09-20'), dueDate: new Date('2026-10-20'),
  subtotal: 1000, taxAmount: 160, totalAmount: 1160, amountPaid: 0, discountAmount: 0,
  internalNotes: null, postedById: null, lockVersion: 0, exchangeRateToBase: 1,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.user.findMany.mockResolvedValue([])
})

describe('invoices for the screens, read from the invoices table', () => {
  it('takes name, type, status and money from the table, not the frozen copy', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([row({ client: { name: 'Renamed Ltd' }, amountPaid: 500 })])
    const [inv] = await loadScreenInvoices([{ id: 'inv-1', partnerName: 'Old Name', amountPaid: 0, status: 'draft' }])
    expect(inv).toMatchObject({ partnerName: 'Renamed Ltd', type: 'customer_invoice', status: 'posted', amountPaid: 500, total: 1160 })
  })

  it('files a bill by its document type even when the contact is also a customer', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([row({ id: 'b-1', invoiceNumber: 'BILL/2026/0001', documentType: 'vendor_bill' })])
    const [inv] = await loadScreenInvoices([])
    expect(inv.type).toBe('vendor_bill')
  })

  it('lists payments from the payments table and keeps reversed ones apart', async () => {
    const user = { username: 'fin' }
    mockPrisma.invoice.findMany.mockResolvedValue([row({
      amountPaid: 1160,
      paymentAllocations: [
        { paymentId: 'p-1', amount: 1160, reversedAt: null, payment: { id: 'p-1', paidAt: new Date('2026-09-21'), paymentMethod: 'mpesa', reference: 'QWE', isVoided: false, createdBy: user, voidedBy: null } },
        { paymentId: 'p-0', amount: 2000, reversedAt: new Date('2026-09-22'), payment: { id: 'p-0', paidAt: new Date('2026-09-21'), paymentMethod: 'cash', isVoided: true, voidedAt: new Date('2026-09-22'), voidReason: 'wrong amount', createdBy: user, voidedBy: user } },
      ],
    })])
    const [inv] = await loadScreenInvoices([])
    expect(inv.payments).toEqual([expect.objectContaining({ id: 'p-1', amount: 1160, method: 'mpesa', reference: 'QWE', recordedBy: 'fin' })])
    expect(inv.voidedPayments).toEqual([expect.objectContaining({ id: 'p-0', amount: 2000, reversalReason: 'wrong amount' })])
  })

  it("keeps the frozen copy's line ids and serials when the lines are the same", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([row({
      items: [{ id: 'item-uuid', description: 'Laptop', qty: 1, unitPrice: 1000, taxRate: 16, lineSubtotal: 1000, productId: 'p-1', sortOrder: 0, serialNumberId: null, taxCategory: 'standard' }],
    })])
    const [inv] = await loadScreenInvoices([{ id: 'inv-1', lines: [{ id: 'line-1', description: 'Laptop', serialIds: ['s-1'] }] }])
    expect(inv.lines[0]).toMatchObject({ id: 'line-1', description: 'Laptop', qty: 1, unitPrice: 1000, serialIds: ['s-1'] })
  })

  it('still shows a document that only the frozen copy has', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([row()])
    const list = await loadScreenInvoices([{ id: 'inv-1' }, { id: 'store-only', ref: 'BILL/2026/0010' }])
    expect(list.map(r => r.id)).toEqual(['inv-1', 'store-only'])
  })

  it('reads the opening-balance marker and the new table fields', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([row({ internalNotes: '[opening-balance] migrated', deliveryJobId: 'job-1', salespersonName: 'Ann', receiptId: 'grn-1' })])
    const [inv] = await loadScreenInvoices([])
    expect(inv).toMatchObject({ isOpeningBalance: true, deliveryJobId: 'job-1', salespersonName: 'Ann', receiptId: 'grn-1' })
  })
})
