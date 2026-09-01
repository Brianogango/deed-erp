import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPrismaInvoice } = vi.hoisted(() => ({
  mockPrismaInvoice: { findMany: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ default: { invoice: mockPrismaInvoice } }))

import { buildHistoricalAgeing } from '@/lib/accounting/ageing.server'

const baseInvoice = {
  id: 'inv-1',
  invoiceNumber: 'INV/2026/0001',
  clientId: 'c-1',
  invoiceDate: new Date('2026-08-01'),
  dueDate: new Date('2026-08-08'),
  totalAmount: 5000,
  amountPaid: 5000,
  status: 'approved',
  client: { name: 'Acme' },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildHistoricalAgeing payment fallback', () => {
  it('uses the amountPaid cache when an invoice has no allocation rows', async () => {
    // Pre-cutover invoice: fully paid, but no payment_allocations rows exist.
    // It must not age as fully unpaid.
    mockPrismaInvoice.findMany.mockResolvedValue([{ ...baseInvoice, paymentAllocations: [] }])
    const report = await buildHistoricalAgeing({ kind: 'ar', asOf: '2026-09-01' })
    expect(report.totals.balance).toBe(0)
  })

  it('prefers allocation rows when they exist', async () => {
    mockPrismaInvoice.findMany.mockResolvedValue([{
      ...baseInvoice,
      amountPaid: 5000,
      paymentAllocations: [{ amount: 2000 }],
    }])
    const report = await buildHistoricalAgeing({ kind: 'ar', asOf: '2026-09-01' })
    expect(report.totals.balance).toBe(3000)
  })

  it('keeps fully unpaid invoices open', async () => {
    mockPrismaInvoice.findMany.mockResolvedValue([{ ...baseInvoice, amountPaid: 0, paymentAllocations: [] }])
    const report = await buildHistoricalAgeing({ kind: 'ar', asOf: '2026-09-01' })
    expect(report.totals.balance).toBe(5000)
  })
})
