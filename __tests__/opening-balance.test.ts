import { describe, expect, it } from 'vitest'
import {
  MIGRATED_TEXT,
  OPENING_BALANCE_EQUITY_LABEL,
  OPENING_BALANCE_MARKER,
  isOpeningBalanceDocument,
  openingBalanceCorrectionRef,
  openingBalanceJournalLines,
  planOpeningBalanceCorrection,
} from '@/lib/finance/opening-balance'

const AR = '1800 - Accounts Receivable'
const AP = '3000 - Accounts Payable'
const sum = (lines: Array<{ debit: number; credit: number }>, side: 'debit' | 'credit') => lines.reduce((s, l) => s + l[side], 0)

describe('isOpeningBalanceDocument', () => {
  it('recognises every way an opening balance was imported', () => {
    expect(isOpeningBalanceDocument({ isOpeningBalance: true })).toBe(true)
    expect(isOpeningBalanceDocument({ id: 'mig_invoice_abc' })).toBe(true)
    expect(isOpeningBalanceDocument({ internalNotes: `${OPENING_BALANCE_MARKER} x` })).toBe(true)
    expect(isOpeningBalanceDocument({ notes: MIGRATED_TEXT })).toBe(true)
    expect(isOpeningBalanceDocument({ notes: 'custom', lines: [{ description: MIGRATED_TEXT }] })).toBe(true)
  })
  it('does not catch ordinary documents', () => {
    expect(isOpeningBalanceDocument({ id: 'f3e1c1d2-0000-4000-8000-000000000001', notes: 'Laptop sale' })).toBe(false)
    expect(isOpeningBalanceDocument({ notes: `See ${MIGRATED_TEXT} for context`, lines: [{ description: 'HP' }, { description: MIGRATED_TEXT }] })).toBe(false)
    expect(isOpeningBalanceDocument(null)).toBe(false)
  })
})

describe('openingBalanceJournalLines', () => {
  it('customer: Dr Accounts Receivable / Cr Opening Balance Equity — no revenue, no VAT', () => {
    const lines = openingBalanceJournalLines({ type: 'customer_invoice', partner: 'Acme', ref: 'OLD-1', amount: 25000, arLabel: AR, apLabel: AP })
    expect(lines.map(l => [l.accountLabel, l.debit, l.credit])).toEqual([[AR, 25000, 0], [OPENING_BALANCE_EQUITY_LABEL, 0, 25000]])
  })
  it('supplier: Dr Opening Balance Equity / Cr Accounts Payable — no expense', () => {
    const lines = openingBalanceJournalLines({ type: 'vendor_bill', partner: 'Supplier', ref: 'OLD-B', amount: 8000, arLabel: AR, apLabel: AP })
    expect(lines.map(l => [l.accountLabel, l.debit, l.credit])).toEqual([[OPENING_BALANCE_EQUITY_LABEL, 8000, 0], [AP, 0, 8000]])
  })
})

describe('planOpeningBalanceCorrection', () => {
  const doc = { type: 'customer_invoice' as const, ref: 'OLD-1', partner: 'Acme', amount: 25000 }
  const base = { arLabel: AR, apLabel: AP, alreadyCorrected: false }

  it('never reached the ledger → post the opening balance journal', () => {
    const plan = planOpeningBalanceCorrection({ ...base, doc, journal: null })
    expect(plan.action).toBe('post')
    if (plan.action === 'post') expect(plan.lines[1].accountLabel).toBe(OPENING_BALANCE_EQUITY_LABEL)
  })

  it('booked as revenue → move exactly that revenue to 4004, leaving AR as it is', () => {
    const plan = planOpeningBalanceCorrection({
      ...base, doc,
      journal: { lines: [
        { accountLabel: AR, accountType: 'asset', debit: 25000, credit: 0 },
        { accountLabel: '5000 - Sales Revenue', accountType: 'revenue', debit: 0, credit: 25000 },
      ] },
    })
    expect(plan.action).toBe('reclass')
    if (plan.action !== 'reclass') return
    expect(plan.lines.map(l => [l.accountLabel, l.debit, l.credit])).toEqual([
      ['5000 - Sales Revenue', 25000, 0],
      [OPENING_BALANCE_EQUITY_LABEL, 0, 25000],
    ])
    expect(sum(plan.lines, 'debit')).toBe(sum(plan.lines, 'credit'))
  })

  it('a bill booked to expense 6101 → move it to 4004', () => {
    const plan = planOpeningBalanceCorrection({
      ...base, doc: { ...doc, type: 'vendor_bill', ref: 'OLD-B', amount: 8000 },
      journal: { lines: [
        { accountLabel: '6101 - Purchases', accountType: 'expense', debit: 8000, credit: 0 },
        { accountLabel: AP, accountType: 'liability', debit: 0, credit: 8000 },
      ] },
    })
    expect(plan.action).toBe('reclass')
    if (plan.action !== 'reclass') return
    expect(plan.lines.map(l => [l.accountLabel, l.debit, l.credit])).toEqual([
      ['6101 - Purchases', 0, 8000],
      [OPENING_BALANCE_EQUITY_LABEL, 8000, 0],
    ])
  })

  it('revenue split over several accounts moves each one', () => {
    const plan = planOpeningBalanceCorrection({
      ...base, doc,
      journal: { lines: [
        { accountLabel: AR, accountType: 'asset', debit: 25000, credit: 0 },
        { accountLabel: '5000 - Sales Revenue', accountType: 'revenue', debit: 0, credit: 15000 },
        { accountLabel: '5121 - Hardware Support', accountType: 'revenue', debit: 0, credit: 10000 },
      ] },
    })
    if (plan.action !== 'reclass') throw new Error(plan.action)
    expect(plan.lines.at(-1)).toMatchObject({ accountLabel: OPENING_BALANCE_EQUITY_LABEL, credit: 25000 })
    expect(sum(plan.lines, 'debit')).toBe(sum(plan.lines, 'credit'))
  })

  it('leaves correct, corrected and unusual postings alone', () => {
    expect(planOpeningBalanceCorrection({ ...base, doc, journal: { lines: [
      { accountLabel: AR, accountType: 'asset', debit: 25000, credit: 0 },
      { accountLabel: OPENING_BALANCE_EQUITY_LABEL, accountType: 'equity', debit: 0, credit: 25000 },
    ] } }).action).toBe('ok')
    expect(planOpeningBalanceCorrection({ ...base, alreadyCorrected: true, doc, journal: null }).action).toBe('ok')
    expect(planOpeningBalanceCorrection({ ...base, doc, journal: { isReversed: true, lines: [] } }).action).toBe('review')
    expect(planOpeningBalanceCorrection({ ...base, doc, journal: { lines: [
      { accountLabel: AR, accountType: 'asset', debit: 29000, credit: 0 },
      { accountLabel: '5000 - Sales Revenue', accountType: 'revenue', debit: 0, credit: 25000 },
      { accountLabel: '3301 - Output VAT Payable', accountType: 'liability', debit: 0, credit: 4000 },
    ] } }).action).toBe('review')
  })

  it('one correcting journal per document', () => {
    expect(openingBalanceCorrectionRef('OLD-1', 'post')).toBe('JRN/OB/OLD-1')
    expect(openingBalanceCorrectionRef('OLD-1', 'reclass')).toBe('JRN/OBFIX/OLD-1')
  })
})

import { findDuplicateOpeningBalances, repairedMigratedDate } from '@/lib/finance/opening-balance'

describe('repairedMigratedDate — Excel day numbers from the first importer', () => {
  it('reads the day number as a real date', () => {
    expect(repairedMigratedDate('46326')).toBe('2026-10-31')
    expect(repairedMigratedDate(46300)).toBe('2026-10-05')
  })
  it('leaves real dates alone', () => {
    expect(repairedMigratedDate('2026-10-31')).toBeNull()
    expect(repairedMigratedDate('')).toBeNull()
    expect(repairedMigratedDate('12345678')).toBeNull()
  })
})

describe('findDuplicateOpeningBalances — retries of the first importer', () => {
  const bill = (id: string, over: Record<string, unknown> = {}) => ({
    id, type: 'vendor_bill', ref: 'TOKYO-STMT-2026', partnerName: 'Tokyo IT Solutions Ltd.', total: 5032644, amountPaid: 0, ...over,
  })

  it('keeps the first copy and removes the others', () => {
    const { remove, blocked } = findDuplicateOpeningBalances([bill('a'), bill('b'), bill('c')], () => false)
    expect([...remove.keys()]).toEqual(['b', 'c'])
    expect(remove.get('b')).toBe('a')
    expect(blocked.size).toBe(0)
  })

  it('keeps the copy that reached the ledger', () => {
    const { remove } = findDuplicateOpeningBalances([bill('a'), bill('b')], id => id === 'b')
    expect([...remove.keys()]).toEqual(['a'])
  })

  it('never removes a copy with payments, or a second copy already in the ledger', () => {
    const { remove, blocked } = findDuplicateOpeningBalances(
      [bill('a'), bill('b', { amountPaid: 1000 }), bill('c')],
      id => id === 'a' || id === 'c',
    )
    expect(remove.size).toBe(0)
    expect([...blocked.keys()].sort()).toEqual(['b', 'c'])
  })

  it('different references, partners or amounts are different documents', () => {
    const { remove } = findDuplicateOpeningBalances([
      bill('a'), bill('b', { ref: 'TOKYO-STMT-2025' }), bill('c', { total: 1 }), bill('d', { partnerName: 'Other' }), bill('e', { type: 'customer_invoice' }),
    ], () => false)
    expect(remove.size).toBe(0)
  })
})
