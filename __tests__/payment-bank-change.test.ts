import { beforeEach, describe, expect, it, vi } from 'vitest'

const store: Record<string, any> = {}
const journals: any[] = []
const prismaPayments = new Map<string, any>()
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
    payment: { findUnique: async ({ where }: any) => prismaPayments.get(where.id) ?? null, update: async ({ where, data }: any) => { Object.assign(prismaPayments.get(where.id), data) } },
    bankReconciliationMatch: { findFirst: async () => null },
  },
}))
vi.mock('@/lib/accounting/journal-service', () => ({ createJournalEntry: async (e: any) => { journals.push(e); return { id: 'j' } } }))
vi.mock('@/lib/accounting/bank-cash-account.server', () => ({ cashLabelForBankAccount: async (_db: any, id: string) => ({ ncba: '1110 - NCBA', eq: '1120 - Equity', mpesa: '1150 - M-Pesa' } as any)[id] ?? `GL ${id}` }))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: async () => {} }))
vi.mock('@/lib/fiscal-lock.server', () => ({ checkFiscalLock: async () => ({ ok: true }) }))

const PID = '11111111-1111-4111-8111-111111111111'
const actor = { id: 'u1', name: 'Faith' }

beforeEach(() => {
  journals.length = 0
  prismaPayments.clear()
  prismaPayments.set(PID, { id: PID, isVoided: false, journalId: null, reconciliationStatus: 'unreconciled', bankAccountId: null })
  store.deed_bankAccounts = [
    { id: 'ncba', name: 'NCBA Current Account', accountNo: '1001237890', active: true },
    { id: 'eq', name: 'Equity Business', accountNo: '01702912345', active: true },
  ]
  store.deed_bankStatementLines = []
  store.deed_invoices = [
    { id: 'inv1', ref: 'INV/0101', type: 'customer_invoice', total: 5000, payments: [{ id: PID, amount: 5000, method: 'bank_transfer', bankAccountId: 'ncba' }] },
    { id: 'bill1', ref: 'BILL/0042', type: 'vendor_bill', total: 3000, payments: [{ id: 'p2', amount: 3000, method: 'bank_transfer' }] },
  ]
})

describe('changePaymentBank', () => {
  it('moves a receipt: Dr the new bank, Cr the old one; payment records it', async () => {
    const { changePaymentBank } = await import('@/lib/accounting/payment-bank-change.server')
    const out = await changePaymentBank({ invoiceId: 'inv1', paymentId: PID, bankAccountId: 'eq', reason: 'Paid into Equity', actor })
    expect(out).toMatchObject({ from: 'ncba', to: 'eq' })
    expect(journals[0].lines).toEqual([
      expect.objectContaining({ accountLabel: '1120 - Equity', debit: 5000, credit: 0 }),
      expect.objectContaining({ accountLabel: '1110 - NCBA', debit: 0, credit: 5000 }),
    ])
    const pay = store.deed_invoices[0].payments[0]
    expect(pay.bankAccountId).toBe('eq')
    expect(pay.bankChanges[0]).toMatchObject({ from: 'ncba', to: 'eq', by: 'Faith', reason: 'Paid into Equity' })
  })

  it('moves a bill payment the other way, from the default account', async () => {
    const { changePaymentBank } = await import('@/lib/accounting/payment-bank-change.server')
    await changePaymentBank({ invoiceId: 'bill1', paymentId: 'p2', bankAccountId: 'eq', reason: 'Paid from Equity', actor })
    expect(journals[0].lines).toEqual([
      expect.objectContaining({ accountLabel: '1110 - NCBA', debit: 3000 }),
      expect.objectContaining({ accountLabel: '1120 - Equity', credit: 3000 }),
    ])
  })

  it('refuses a payment matched in bank reconciliation, and changes nothing', async () => {
    store.deed_bankStatementLines = [{ id: 'l1', matchedEntryId: `inv-pay-inv1-${PID}` }]
    const { changePaymentBank } = await import('@/lib/accounting/payment-bank-change.server')
    await expect(changePaymentBank({ invoiceId: 'inv1', paymentId: PID, bankAccountId: 'eq', reason: 'x y z', actor })).rejects.toMatchObject({ status: 409 })
    expect(journals).toHaveLength(0)
    expect(store.deed_invoices[0].payments[0].bankAccountId).toBe('ncba')
  })

  it('refuses the same account, a missing reason, or an unknown account', async () => {
    const { changePaymentBank } = await import('@/lib/accounting/payment-bank-change.server')
    await expect(changePaymentBank({ invoiceId: 'inv1', paymentId: PID, bankAccountId: 'ncba', reason: 'same one', actor })).rejects.toMatchObject({ status: 409 })
    await expect(changePaymentBank({ invoiceId: 'inv1', paymentId: PID, bankAccountId: 'eq', reason: '', actor })).rejects.toMatchObject({ status: 422 })
    await expect(changePaymentBank({ invoiceId: 'inv1', paymentId: PID, bankAccountId: 'nope', reason: 'abc', actor })).rejects.toMatchObject({ status: 422 })
    expect(journals).toHaveLength(0)
  })
})
