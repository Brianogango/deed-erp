/**
 * The customer paid the rider the delivery charge directly: it stays off our
 * books — cut from a draft, credit note on a posted invoice — and comes off
 * the rider's pay. Plus the fix for trips booked the first way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  state: {} as Record<string, any>,
  invoice: null as any,
  journals: 0,
  creditNotes: [] as any[],
  payments: [] as any[],
  reversed: [] as any[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/server-store', () => {
  const read = async (keys: string[]) => Object.fromEntries(keys.map(k => [k, h.state[k] ? JSON.parse(JSON.stringify(h.state[k])) : undefined]))
  return {
    loadAppState: read,
    loadAppStateForWrite: read,
    saveStoreKeys: async (e: Record<string, string>) => { for (const [k, v] of Object.entries(e)) h.state[k] = JSON.parse(v) },
    withAppStateKeyLock: async (_k: string, fn: () => Promise<unknown>) => fn(),
    notifyStoreKeysChanged: async () => {},
  }
})
vi.mock('@/lib/fiscal-lock.server', () => ({ checkFiscalLock: async () => ({ ok: true }) }))
vi.mock('@/lib/notifications/service', () => ({ publishNotificationEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/doc-ref-counter', () => ({ getNextDocNumber: async () => 'CN/0001' }))
vi.mock('@/lib/accounting/credit-note-service', () => ({
  createCustomerCreditNote: vi.fn(async (input: any) => {
    const item = h.invoice.items.find((i: any) => i.id === input.lines[0].invoiceItemId)
    const amount = Math.round(item.lineTotal * input.lines[0].qty / item.qty * 100) / 100
    const open = h.invoice.totalAmount - h.invoice.amountPaid
    const applied = Math.min(amount, Math.max(0, open))
    h.creditNotes.push({ ...input, amount, creditNoteNumber: input.creditNoteNumber, status: 'applied' })
    return { id: 'cn-1', ref: input.creditNoteNumber, invoiceId: h.invoice.id, amount, appliedToAr: applied, customerCredit: Math.round((amount - applied) * 100) / 100 }
  }),
}))
vi.mock('@/lib/accounting/payment-reversal.server', () => ({
  reverseInvoicePayment: vi.fn(async (p: any) => { h.reversed.push(p); const pay = h.payments.find(x => x.id === p.paymentId); if (pay) pay.isVoided = true; return {} }),
}))
vi.mock('@/lib/prisma', () => {
  const tx = {
    invoiceItem: {
      delete: vi.fn(async ({ where }: any) => { h.invoice.items = h.invoice.items.filter((i: any) => i.id !== where.id) }),
      update: vi.fn(async ({ where, data }: any) => { Object.assign(h.invoice.items.find((i: any) => i.id === where.id), data) }),
      findMany: vi.fn(async () => h.invoice.items.map((i: any) => ({ ...i }))),
    },
    invoice: { update: vi.fn(async ({ data }: any) => { const { lockVersion, ...rest } = data; Object.assign(h.invoice, rest) }) },
  }
  return {
    default: {
      $transaction: vi.fn(async (fn: any) => fn(tx)),
      invoice: {
        findMany: vi.fn(async () => []),
        findUnique: vi.fn(async ({ where }: any) => (h.invoice && where.id === h.invoice.id ? JSON.parse(JSON.stringify(h.invoice)) : null)),
        update: vi.fn(async ({ data }: any) => { Object.assign(h.invoice, data) }),
      },
      journalEntry: { count: vi.fn(async () => h.journals) },
      creditNote: { findFirst: vi.fn(async ({ where }: any) => h.creditNotes.find(c => c.reason === where.reason) ? { creditNoteNumber: 'CN/0001', amount: 348 } : null) },
      creditNoteLine: { aggregate: vi.fn(async () => ({ _sum: { qty: 0 } })) },
      payment: { findMany: vi.fn(async () => h.payments.filter(p => !p.isVoided)) },
    },
  }
})

import { applyCustomerPaidRider, fixOldPaidToRider, paidToRiderPaymentId } from '@/lib/delivery/rider-direct-pay.server'
import { deliveryLineCut, needsOffBooksFix, riderPayForJob } from '@/lib/delivery/rider-direct-pay'

const deliveryLine = { id: 'it-d', description: 'Delivery charge', qty: 1, unitPrice: 300, taxRate: 16, discountPct: 0, lineSubtotal: 300, lineTax: 48, lineTotal: 348 }
const laptop = { id: 'it-1', description: 'HP EliteBook', qty: 1, unitPrice: 5000, taxRate: 16, discountPct: 0, lineSubtotal: 5000, lineTax: 800, lineTotal: 5800 }
const opts = { by: 'Otieno', capToCharge: true }

beforeEach(() => {
  h.journals = 0
  h.creditNotes = []
  h.payments = []
  h.reversed = []
  h.invoice = { id: 'inv-1', invoiceNumber: 'INV/0007', status: 'approved', totalAmount: 6148, amountPaid: 0, createdById: 'u-1', clientId: 'c-1', client: { name: 'Acme' }, notes: '', items: [{ ...laptop }, { ...deliveryLine }] }
  h.state = {
    deed_deliveryJobs: [{ id: 'j1', ref: 'DLV/0001', status: 'in_transit', riderId: 'r1', riderName: 'Otieno', riderFee: 250, deliveryFee: 300, invoiceId: 'inv-1', customerName: 'Acme' }],
    deed_riderWeeklyPays: [],
    deed_customerCredits: [],
  }
})

describe('helpers', () => {
  it('rider pay is the fee less what the customer paid, never below zero', () => {
    expect(riderPayForJob({ riderFee: 400, customerPaidRider: { amount: 300 } })).toBe(100)
    expect(riderPayForJob({ riderFee: 250, customerPaidRider: { amount: 300 } })).toBe(0)
  })
  it('sizes the cut of the delivery line from its price before VAT', () => {
    expect(deliveryLineCut({ qty: 1, lineSubtotal: 300 }, 1, 300)).toEqual({ qty: 1, fraction: 1 })
    expect(deliveryLineCut({ qty: 1, lineSubtotal: 300 }, 1, 150)).toEqual({ qty: 0.5, fraction: 0.5 })
    expect(deliveryLineCut({ qty: 1, lineSubtotal: 300 }, 0, 300).qty).toBe(0)
  })
})

describe('posted invoice', () => {
  it('takes the delivery line off with a credit note — no payment, no expense', async () => {
    const out = await applyCustomerPaidRider('j1', { amount: 300, method: 'mpesa' }, opts) as any
    expect(out.ok).toBe(true)
    expect(out.offBooks).toMatchObject({ kind: 'credit_note', creditNoteRef: 'CN/0001', amount: 348, customerCredit: 0 })
    expect(h.creditNotes[0]).toMatchObject({ invoiceId: 'inv-1', lines: [{ invoiceItemId: 'it-d', qty: 1 }], actorId: 'u-1' })
    expect(h.state.deed_deliveryJobs[0].customerPaidRider).toMatchObject({ amount: 300, creditNoteRef: 'CN/0001', invoiceRef: 'INV/0007' })
    expect(h.state.deed_customerCredits).toEqual([])
  })

  it('already paid to us in full: the credit becomes customer credit', async () => {
    h.invoice.amountPaid = 6148
    const out = await applyCustomerPaidRider('j1', { amount: 300, method: 'cash' }, opts) as any
    expect(out.offBooks.customerCredit).toBe(348)
    expect(h.state.deed_customerCredits[0]).toMatchObject({ ref: 'CN/0001', amount: 348, status: 'available', sourceInvoiceId: 'inv-1' })
  })

  it('a second tap changes nothing', async () => {
    await applyCustomerPaidRider('j1', { amount: 300, method: 'cash' }, opts)
    expect(await applyCustomerPaidRider('j1', { amount: 300, method: 'cash' }, opts)).toMatchObject({ ok: false })
    expect(h.creditNotes).toHaveLength(1)
  })
})

describe('draft invoice', () => {
  it('removes the delivery line', async () => {
    h.invoice.status = 'draft'
    const out = await applyCustomerPaidRider('j1', { amount: 300, method: 'cash' }, opts) as any
    expect(out.offBooks).toMatchObject({ kind: 'draft', removed: 348 })
    expect(h.invoice.items.map((i: any) => i.id)).toEqual(['it-1'])
    expect(h.invoice).toMatchObject({ subtotal: 5000, taxAmount: 800, totalAmount: 5800 })
    expect(h.creditNotes).toHaveLength(0)
  })

  it('shrinks it when the rider got part of the charge', async () => {
    h.invoice.status = 'draft'
    await applyCustomerPaidRider('j1', { amount: 100, method: 'cash' }, opts)
    expect(h.invoice.items.find((i: any) => i.id === 'it-d')).toMatchObject({ unitPrice: 200, lineSubtotal: 200, lineTotal: 232 })
    expect(h.invoice.totalAmount).toBe(6032)
  })

  it('a charge-only draft with nothing left is cancelled', async () => {
    h.invoice.status = 'draft'
    h.invoice.items = [{ ...deliveryLine, description: 'Delivery charge — INV/0006 (DLV/0001)' }]
    await applyCustomerPaidRider('j1', { amount: 300, method: 'cash' }, opts)
    expect(h.invoice.status).toBe('cancelled')
  })
})

describe('limits', () => {
  it('refuses more than the delivery charge from the rider link, and a trip in a pay run', async () => {
    expect(await applyCustomerPaidRider('j1', { amount: 1000, method: 'cash' }, opts)).toMatchObject({ ok: false })
    h.state.deed_riderWeeklyPays = [{ ref: 'RP/1', jobIds: ['j1'] }]
    expect(await applyCustomerPaidRider('j1', { amount: 300, method: 'cash' }, opts)).toMatchObject({ ok: false, status: 409 })
    expect(h.creditNotes).toHaveLength(0)
  })

  it('no delivery charge billed: only the rider pay changes', async () => {
    h.invoice.items = [{ ...laptop }]
    const out = await applyCustomerPaidRider('j1', { amount: 250, method: 'cash' }, opts) as any
    expect(out.offBooks.kind).toBe('none')
    expect(h.creditNotes).toHaveLength(0)
  })
})

describe('fixing trips booked the first way', () => {
  it('reverses the paid-to-rider payment and credits the line instead', async () => {
    h.state.deed_deliveryJobs[0].customerPaidRider = { amount: 300, method: 'cash', at: 'x', by: 'Otieno', invoiceId: 'inv-1', invoiceRef: 'INV/0007', settled: 300 }
    h.payments = [{ id: paidToRiderPaymentId('j1'), amount: 300, reference: 'Paid to rider Otieno (DLV/0001)', isVoided: false }]
    h.invoice.amountPaid = 300
    expect(needsOffBooksFix(h.state.deed_deliveryJobs[0])).toBe(true)
    const out = await fixOldPaidToRider('j1', { id: 'fin', name: 'Finance' }) as any
    expect(out.ok).toBe(true)
    expect(out.reversed).toBe(300)
    expect(h.reversed[0]).toMatchObject({ invoiceId: 'inv-1', paymentId: paidToRiderPaymentId('j1') })
    expect(out.offBooks.kind).toBe('credit_note')
    const rec = h.state.deed_deliveryJobs[0].customerPaidRider
    expect(rec).toMatchObject({ creditNoteRef: 'CN/0001', reversedPayment: 300 })
    expect(needsOffBooksFix(h.state.deed_deliveryJobs[0])).toBe(false)
  })
})
