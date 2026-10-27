import { beforeEach, describe, expect, it, vi } from 'vitest'

type Inv = { id: string; invoiceNumber: string; amountPaid: number; totalAmount: number; clientId: string; notes: string | null }

const m = vi.hoisted(() => ({
  invoices: new Map<string, any>(),
  payment: null as any,
  journals: [] as any[],
  journalUpdates: [] as any[],
  depositApps: [] as any[],
  deposits: new Map<string, any>(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/fiscal-lock.server', () => ({ checkFiscalLock: async () => ({ ok: true }) }))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAuditInTx: vi.fn(async () => {}) }))
vi.mock('@/lib/server-store', () => ({
  withAppStateKeyLock: (_k: string, fn: () => unknown) => fn(),
  loadAppStateForWrite: async () => ({ deed_invoices: [], deed_journalEntries: [] }),
  saveStoreKeys: async () => {},
  notifyStoreKeysChanged: async () => {},
}))
vi.mock('@/lib/accounting/journal-service', () => ({
  createJournalEntryInTx: vi.fn(async (_tx: unknown, data: any) => { m.journals.push(data); return { id: 'rev-1' } }),
}))

const tx = {
  payment: {
    findUniqueOrThrow: async () => m.payment,
    update: async ({ data }: any) => Object.assign(m.payment, data),
  },
  paymentAllocation: { updateMany: async () => ({}) },
  depositApplication: {
    findMany: async ({ where }: any) => m.depositApps.filter(a => a.paymentId === where.paymentId && a.status === where.status),
    update: async ({ where, data }: any) => Object.assign(m.depositApps.find(a => a.id === where.id), data),
  },
  deposit: {
    findUnique: async ({ where }: any) => m.deposits.get(where.id) ?? null,
    update: async ({ where, data }: any) => Object.assign(m.deposits.get(where.id), data),
  },
  invoice: {
    findUnique: async ({ where }: any) => m.invoices.get(where.id) ?? null,
    findFirst: async ({ where }: any) => [...m.invoices.values()].find((i: Inv) => i.invoiceNumber === where.invoiceNumber && i.totalAmount < 0) ?? null,
    update: async ({ where, data }: any) => Object.assign(m.invoices.get(where.id), data),
  },
  journalEntry: {
    findUnique: async () => ({ id: 'j-vcn', ref: 'JRN/VCN/0001', isReversed: false, invoiceId: 'vcn', lines: [{ accountLabel: 'AP', label: 'x', debit: 5000, credit: 0 }], journal: { code: 'PUR' } }),
    update: async (args: any) => { m.journalUpdates.push(args); return {} },
  },
}

vi.mock('@/lib/prisma', () => ({
  default: {
    payment: { findUnique: async () => m.payment },
    depositApplication: { findMany: async ({ where }: any) => m.depositApps.filter(a => a.paymentId === where.paymentId && a.status === where.status) },
    bankReconciliationMatch: { findFirst: async () => null },
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  },
}))

import { reverseInvoicePayment, restoredAmountPaid } from '@/lib/accounting/payment-reversal.server'

const actor = { id: 'u1', name: 'Ann' }

beforeEach(() => {
  m.invoices = new Map()
  m.journals = []
  m.journalUpdates = []
  m.depositApps = []
  m.deposits = new Map()
})

describe('restoredAmountPaid', () => {
  it('moves a bill down towards 0 and a credit note up towards 0', () => {
    expect(restoredAmountPaid(10000, 6000, 2500)).toBe(3500)
    expect(restoredAmountPaid(10000, 1000, 2500)).toBe(0)
    expect(restoredAmountPaid(-8000, -5000, 2000)).toBe(-3000)
    expect(restoredAmountPaid(-8000, -1000, 2000)).toBe(0)
  })
})

describe('reversing a supplier credit applied to a bill', () => {
  beforeEach(() => {
    m.invoices.set('bill', { id: 'bill', invoiceNumber: 'BILL/0228', amountPaid: 3500, totalAmount: 10000, clientId: 'sup', notes: null })
    m.invoices.set('vcn', { id: 'vcn', invoiceNumber: 'VCN/2026/0001', amountPaid: -3500, totalAmount: -3500, clientId: 'sup', notes: null })
    m.payment = {
      id: 'pay-1', invoiceId: 'bill', amount: 3500, isVoided: false, partnerId: 'sup',
      notes: 'method:vendor_credit · Credit VCN/2026/0001 applied', reference: 'VCN/2026/0001', externalReference: 'VCN/2026/0001',
      journalId: 'j-vcn', reconciliationStatus: 'not_applicable', paymentMethod: 'credit', paidAt: new Date(),
      allocations: [{ invoiceId: 'bill', amount: 3500 }],
    }
  })

  it('gives the amount back to the credit note and the bill owes it again', async () => {
    const res = await reverseInvoicePayment({ invoiceId: 'bill', paymentId: 'pay-1', reason: 'wrong bill', actor })
    expect(m.invoices.get('bill').amountPaid).toBe(0)
    expect(m.invoices.get('vcn').amountPaid).toBe(0)
    expect(res.amountPaidByInvoice).toEqual({ bill: 0, vcn: 0 })
  })

  it('does not reverse the credit note journal', async () => {
    const res = await reverseInvoicePayment({ invoiceId: 'bill', paymentId: 'pay-1', reason: 'wrong bill', actor })
    expect(m.journals).toHaveLength(0)
    expect(m.journalUpdates).toHaveLength(0)
    expect(res.reversalJournalRef).toBeNull()
  })

  it('refuses when the credit note cannot be found', async () => {
    m.invoices.delete('vcn')
    await expect(reverseInvoicePayment({ invoiceId: 'bill', paymentId: 'pay-1', reason: 'wrong bill', actor })).rejects.toThrow(/not found/)
  })
})

describe('reversing a supplier refund', () => {
  it('reverses its own journal and gives the amount back to the credit note', async () => {
    m.invoices.set('vcn', { id: 'vcn', invoiceNumber: 'VCN/2026/0002', amountPaid: -5000, totalAmount: -8000, clientId: 'sup', notes: null })
    m.payment = {
      id: 'pay-2', invoiceId: 'vcn', amount: 2000, isVoided: false, partnerId: 'sup',
      notes: 'method:vendor_refund', reference: null, externalReference: null,
      journalId: 'j-ref', reconciliationStatus: 'not_applicable', paymentMethod: 'bank_transfer', paidAt: new Date(),
      allocations: [],
    }
    await reverseInvoicePayment({ invoiceId: 'vcn', paymentId: 'pay-2', reason: 'bounced', actor })
    expect(m.invoices.get('vcn').amountPaid).toBe(-3000)
    expect(m.journals).toHaveLength(1)
  })
})

describe('reversing a deposit applied to an invoice', () => {
  beforeEach(() => {
    m.invoices.set('inv', { id: 'inv', invoiceNumber: 'INV/0300', amountPaid: 20000, totalAmount: 50000, clientId: 'cus', notes: null })
    m.deposits.set('dep', { id: 'dep', status: 'completed', balance: 0, completedAt: new Date() })
    m.depositApps = [{ id: 'da-1', depositId: 'dep', paymentId: 'pay-3', status: 'applied' }]
    m.payment = {
      id: 'pay-3', invoiceId: 'inv', amount: 20000, isVoided: false, partnerId: 'cus',
      notes: 'Applied customer deposit DEP/0007', reference: 'DEP/DEP/0007', externalReference: 'DEP/DEP/0007',
      journalId: 'j-dep', reconciliationStatus: 'not_applicable', paymentMethod: 'credit', paidAt: new Date(),
      allocations: [{ invoiceId: 'inv', amount: 20000 }],
    }
  })

  it('reverses the use, reopens the deposit and reverses the application journal', async () => {
    await reverseInvoicePayment({ invoiceId: 'inv', paymentId: 'pay-3', reason: 'wrong invoice', actor })
    expect(m.invoices.get('inv').amountPaid).toBe(0)
    expect(m.depositApps[0].status).toBe('reversed')
    expect(m.deposits.get('dep')).toMatchObject({ status: 'fully_paid', completedAt: null })
    expect(m.journals).toHaveLength(1)
  })

  it('allows an older record tagged deposit_apply once its deposit use is found', async () => {
    m.payment.notes = 'method:deposit_apply'
    await expect(reverseInvoicePayment({ invoiceId: 'inv', paymentId: 'pay-3', reason: 'wrong invoice', actor })).resolves.toBeTruthy()
  })

  it('still refuses a browser-made deposit record with no deposit use', async () => {
    m.payment.notes = 'method:deposit_apply'
    m.depositApps = []
    await expect(reverseInvoicePayment({ invoiceId: 'inv', paymentId: 'pay-3', reason: 'wrong invoice', actor })).rejects.toThrow(/deposit/)
  })
})
