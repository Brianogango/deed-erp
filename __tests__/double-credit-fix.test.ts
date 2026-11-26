import { beforeEach, describe, expect, it, vi } from 'vitest'

// INV paid 11,600 (10,000 + VAT 1,600). Credit note CN/1 for 2,320 given as
// customer credit. Then the invoice was cancelled: CN/2 credited the full
// 11,600 again. The extra is 2,320.
const store: Record<string, any> = {}
const journals: any[] = []
vi.mock('server-only', () => ({}))
vi.mock('@/lib/server-store', () => ({
  loadAppState: async (keys: string[]) => Object.fromEntries(keys.map(k => [k, store[k] ?? []])),
  loadAppStateForWrite: async (keys: string[]) => Object.fromEntries(keys.map(k => [k, store[k] ?? []])),
  saveStoreKeys: async (e: Record<string, string>) => { for (const [k, v] of Object.entries(e)) store[k] = JSON.parse(v) },
  notifyStoreKeysChanged: async () => {},
  withAppStateKeyLock: async (_k: string, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('@/lib/prisma', () => ({
  default: {
    invoice: { findUnique: async () => ({ id: 'inv1', invoiceNumber: 'INV/0007', amountPaid: 11600, totalAmount: 11600, subtotal: 10000, taxAmount: 1600 }) },
    creditNote: { findMany: async () => [{ creditNoteNumber: 'CN/1', amount: 2320 }] },
  },
}))
vi.mock('@/lib/accounting/journal-service', () => ({ persistStoreJournalEntry: async (e: any) => { journals.push(e); return e } }))
vi.mock('@/lib/accounting/coa-roles', () => ({ labelForRole: (r: string) => r }))
vi.mock('@/lib/accounting/liability-accounts', () => ({ CUSTOMER_CREDITS_ACCOUNT: '3313 - Customer Credits' }))
vi.mock('@/lib/product-accounts', () => ({ COMPANY_ACCOUNT_FALLBACKS: { saleAccountCode: '5000' }, formatAccountLabel: () => '5000 - Sales Revenue' }))

const cancelCredit = (over: any = {}) => ({ id: 'c2', ref: 'CN/2', customerName: 'Acme', sourceInvoiceId: 'inv1', amount: 11600, balance: 11600, status: 'available',
  notes: 'Credit note generated from cancelled paid invoice INV/0007', ...over })

beforeEach(() => {
  journals.length = 0
  store.deed_customerCredits = [
    { id: 'c1', ref: 'CN/1', sourceInvoiceId: 'inv1', amount: 2320, balance: 2320, status: 'available', notes: 'Overcharge' },
    cancelCredit(),
  ]
})

describe('double credits from cancelled invoices', () => {
  it('finds the extra on the cancel credit', async () => {
    const { findDoubleCredits } = await import('@/lib/finance/double-credit-fix.server')
    const rows = await findDoubleCredits()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ creditRef: 'CN/2', alreadyCredited: 2320, correctAmount: 9280, extra: 2320, fixable: true })
  })

  it('takes it back: credit lowered, sale and VAT put back in one balanced journal', async () => {
    const { fixDoubleCredit, findDoubleCredits } = await import('@/lib/finance/double-credit-fix.server')
    await fixDoubleCredit('c2', { id: 'u1', name: 'Faith' })
    const c = store.deed_customerCredits.find((x: any) => x.id === 'c2')
    expect(c).toMatchObject({ amount: 9280, balance: 9280, doubleCreditRemoved: 2320, doubleCreditFixedBy: 'Faith' })
    const j = journals[0]
    expect(j.ref).toBe('JRN/FIX/CN/2')
    const dr = j.lines.reduce((s: number, l: any) => s + l.debit, 0)
    const cr = j.lines.reduce((s: number, l: any) => s + l.credit, 0)
    expect(dr).toBe(2320); expect(cr).toBe(2320)
    expect(j.lines.find((l: any) => l.account === 'output_vat').credit).toBe(320)
    // Fixed once: nothing left to take back.
    expect(await findDoubleCredits()).toHaveLength(0)
  })

  it('will not take back credit the customer already used', async () => {
    store.deed_customerCredits[1] = cancelCredit({ balance: 1000, status: 'partially_used' })
    const { fixDoubleCredit, findDoubleCredits } = await import('@/lib/finance/double-credit-fix.server')
    expect((await findDoubleCredits())[0].fixable).toBe(false)
    await expect(fixDoubleCredit('c2', { id: 'u1', name: 'Faith' })).rejects.toMatchObject({ status: 409 })
    expect(journals).toHaveLength(0)
  })

  it('leaves a cancel credit with no earlier credit note alone', async () => {
    store.deed_customerCredits = [cancelCredit()]
    const { findDoubleCredits } = await import('@/lib/finance/double-credit-fix.server')
    const prisma = (await import('@/lib/prisma')).default as any
    const was = prisma.creditNote.findMany
    prisma.creditNote.findMany = async () => []
    expect(await findDoubleCredits()).toHaveLength(0)
    prisma.creditNote.findMany = was
  })
})
