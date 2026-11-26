import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelCreditJournalLines } from '@/lib/finance/cancel-customer-credit'

const CC = '3313 - Customer Credits'

describe('cancelCreditJournalLines', () => {
  it('undoes a cancelled-invoice credit: Dr Customer Credits, Cr Sales and VAT in proportion', () => {
    const original = [
      { accountLabel: '5000 - Sales Revenue', debit: 10000, credit: 0 },
      { accountLabel: '3301 - Output VAT Payable', debit: 1600, credit: 0 },
      { accountLabel: CC, debit: 0, credit: 11600 },
    ]
    const lines = cancelCreditJournalLines(original, 2320, CC, 'CN/2')!
    expect(lines[0]).toMatchObject({ accountLabel: CC, debit: 2320 })
    expect(lines.find(l => l.accountLabel.startsWith('5000'))!.credit).toBe(2000)
    expect(lines.find(l => l.accountLabel.startsWith('3301'))!.credit).toBe(320)
  })

  it('ignores the receivable side of a credit note that was partly applied to the invoice', () => {
    const original = [
      { accountLabel: '5000 - Sales Revenue', debit: 862.07, credit: 0 },
      { accountLabel: '3301 - Output VAT Payable', debit: 137.93, credit: 0 },
      { accountLabel: '1800 - Accounts Receivable', debit: 0, credit: 400 },
      { accountLabel: CC, debit: 0, credit: 600 },
    ]
    const lines = cancelCreditJournalLines(original, 333.33, CC, 'CN/9')!
    const dr = lines.reduce((s, l) => s + l.debit, 0), cr = lines.reduce((s, l) => s + l.credit, 0)
    expect(Math.round(dr * 100)).toBe(33333)
    expect(Math.round(cr * 100)).toBe(33333)
    expect(lines.some(l => l.accountLabel.startsWith('1800'))).toBe(false)
  })

  it('returns nothing when the original has no source to put back', () => {
    expect(cancelCreditJournalLines([{ accountLabel: CC, debit: 0, credit: 100 }], 50, CC, 'X')).toBeNull()
  })
})

// The server action: credit lowered, no money out, refused without its origin.
const store: Record<string, any> = {}
const posted: any[] = []
let journals: any[] = []
vi.mock('server-only', () => ({}))
vi.mock('@/lib/server-store', () => ({
  loadAppStateForWrite: async (keys: string[]) => Object.fromEntries(keys.map(k => [k, store[k] ?? []])),
  saveStoreKeys: async (e: Record<string, string>) => { for (const [k, v] of Object.entries(e)) store[k] = JSON.parse(v) },
  notifyStoreKeysChanged: async () => {},
  withAppStateKeyLock: async (_k: string, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('@/lib/prisma', () => ({ default: { journalEntry: { findMany: async ({ where }: any) => journals.filter(j => where.ref.in.includes(j.ref)) } } }))
vi.mock('@/lib/accounting/coa-roles', () => ({ labelForRole: () => CC }))
vi.mock('@/lib/accounting/bank-cash-account.server', () => ({ cashLabelForBankAccount: async () => 'bank' }))
vi.mock('@/lib/accounting/journal-service', () => ({ createJournalEntry: async (e: any) => { posted.push(e); return { id: 'j' } } }))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: async () => {} }))

describe('cancelCustomerCredit', () => {
  beforeEach(() => {
    posted.length = 0
    store.deed_customerCredits = [{ id: 'c2', ref: 'CN/2', customerName: 'Acme', amount: 11600, balance: 11600, status: 'available' }]
    journals = [{ ref: 'JRN/CN/2', lines: [
      { accountLabel: '5000 - Sales Revenue', debit: 10000, credit: 0 },
      { accountLabel: '3301 - Output VAT Payable', debit: 1600, credit: 0 },
      { accountLabel: CC, debit: 0, credit: 11600 },
    ] }]
  })

  it('cancels part of a credit without paying anything out', async () => {
    const { cancelCustomerCredit } = await import('@/lib/accounting/customer-credit-balance.server')
    const out = await cancelCustomerCredit({ creditId: 'c2', amount: 2320, reason: 'Double credit', date: new Date('2026-11-26'), actor: { id: 'u', name: 'Faith' } })
    expect(out).toMatchObject({ cancelled: 2320, balance: 9280 })
    expect(store.deed_customerCredits[0]).toMatchObject({ balance: 9280, status: 'partially_used' })
    expect(posted[0].lines.some((l: any) => /bank|cash/i.test(l.accountLabel))).toBe(false)
    expect(posted[0].ref).toBe('JRN/CRCAN/CN/2/1')
  })

  it('cancelling all of an unused credit voids it', async () => {
    const { cancelCustomerCredit } = await import('@/lib/accounting/customer-credit-balance.server')
    await cancelCustomerCredit({ creditId: 'c2', reason: 'Issued in error', date: new Date(), actor: { id: 'u', name: 'Faith' } })
    expect(store.deed_customerCredits[0]).toMatchObject({ balance: 0, status: 'void' })
  })

  it('refuses without a reason, above the balance, or when the creating entry is missing', async () => {
    const { cancelCustomerCredit } = await import('@/lib/accounting/customer-credit-balance.server')
    const base = { creditId: 'c2', date: new Date(), actor: { id: 'u', name: 'F' } }
    await expect(cancelCustomerCredit({ ...base, reason: ' ' })).rejects.toThrow(/why/)
    await expect(cancelCustomerCredit({ ...base, reason: 'x', amount: 20000 })).rejects.toThrow(/left/)
    journals = []
    await expect(cancelCustomerCredit({ ...base, reason: 'x' })).rejects.toThrow(/manual journal/)
    expect(posted).toHaveLength(0)
    expect(store.deed_customerCredits[0].balance).toBe(11600)
  })
})
