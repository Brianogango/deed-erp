import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  invoice: null as any,
  live: [] as Array<{ id: string; ref: string; totalDebit: number }>,
  reversed: [] as string[],
  posted: [] as any[],
  updates: [] as any[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  default: {
    invoice: {
      findUniqueOrThrow: vi.fn(async () => h.invoice),
      update: vi.fn(async ({ data }: any) => { h.updates.push(data); return {} }),
    },
    journalEntry: { findMany: vi.fn(async () => h.live) },
  },
}))
vi.mock('@/lib/accounting/journal-service', () => ({ reverseJournalEntry: vi.fn(async (ref: string) => { h.reversed.push(ref) }) }))
vi.mock('@/lib/accounting/invoice-journals', () => ({
  postInvoiceJournalToPrisma: vi.fn(async (inv: any) => { h.posted.push(inv); return { id: 'j-new', ref: `JRN/${inv.invoiceNumber}/2` } }),
}))

import { ensureInvoiceBooked } from '@/lib/accounting/ensure-invoice-booked.server'

beforeEach(() => {
  h.invoice = {
    id: 'i1', invoiceNumber: 'INV/2026/0308', documentType: 'customer_invoice', totalAmount: 11000, subtotal: 11000, taxAmount: 0,
    invoiceDate: new Date('2026-10-07'), repairId: 'r1', client: { name: 'Linda Tonui' },
    items: [{ productId: null, qty: 1, unitPrice: 11000, lineSubtotal: 11000, description: 'Screen replacement' }],
  }
  h.live = []; h.reversed = []; h.posted = []; h.updates = []
})

describe('ensureInvoiceBooked', () => {
  it('books a confirmed invoice that has no ledger entry', async () => {
    const out = await ensureInvoiceBooked('i1', 'u1')
    expect(out.action).toBe('booked')
    expect(h.posted[0]).toMatchObject({ invoiceNumber: 'INV/2026/0308', totalAmount: 11000, type: 'customer_invoice' })
    expect(h.updates.at(-1)).toMatchObject({ postingStatus: 'posted', postedJournalEntryId: 'j-new' })
  })

  it('leaves an invoice booked at the right amount alone', async () => {
    h.live = [{ id: 'j1', ref: 'JRN/INV/2026/0308', totalDebit: 11000 }]
    expect((await ensureInvoiceBooked('i1')).action).toBe('already')
    expect(h.posted).toEqual([])
    expect(h.reversed).toEqual([])
  })

  it('re-books a re-approved quote: reverses the old amount, books the new one', async () => {
    h.live = [{ id: 'j1', ref: 'JRN/INV/2026/0308', totalDebit: 8000 }]
    expect((await ensureInvoiceBooked('i1')).action).toBe('rebooked')
    expect(h.reversed).toEqual(['JRN/INV/2026/0308'])
    expect(h.posted).toHaveLength(1)
  })

  it('ignores a delivery charge on the invoice', async () => {
    h.live = [{ id: 'd1', ref: 'JRN/DEL/INV/2026/0308', totalDebit: 500 }]
    expect((await ensureInvoiceBooked('i1')).action).toBe('booked')
    expect(h.reversed).toEqual([])
  })
})
