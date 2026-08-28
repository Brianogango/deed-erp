import { describe, expect, it } from 'vitest'
import {
  autoMatchStatementLines,
  scoreStatementCashbookMatch,
  suggestOutstandingPaymentMatches,
  unmatchedBankChargeTotal,
  unmatchedInterestEarnedTotal,
} from '@/lib/accounting/bank-statement-match'
import {
  assertPostingBalanced,
  buildBankChargeLines,
  buildBankInterestLines,
  resolvePostingAccountLabel,
} from '@/lib/accounting/posting-service'
import { COA_ROLE_CODES, labelForRole } from '@/lib/accounting/coa-roles'

describe('statement ↔ cashbook match', () => {
  it('scores amount+date matches and rejects outliers', () => {
    const stmt = { id: 's1', date: '2026-05-10', debit: 0, credit: 5000 }
    const good = { id: 'e1', date: '2026-05-11', debit: 0, credit: 5000 }
    const badAmt = { id: 'e2', date: '2026-05-11', debit: 0, credit: 5200 }
    expect(scoreStatementCashbookMatch(stmt, good)).not.toBeNull()
    expect(scoreStatementCashbookMatch(stmt, badAmt)).toBeNull()
  })

  it('auto-matches greedily without double-using entries', () => {
    const { lines, matchedCount } = autoMatchStatementLines({
      bankAccountId: 'absa',
      month: '2026-05',
      statementLines: [
        { id: 's1', date: '2026-05-10', debit: 0, credit: 1000 },
        { id: 's2', date: '2026-05-10', debit: 0, credit: 1000 },
      ] as Array<{ id: string; date: string; debit: number; credit: number; matchedEntryId?: string }>,
      cashbookEntries: [
        { id: 'e1', date: '2026-05-10', debit: 0, credit: 1000 },
      ],
    })
    expect(matchedCount).toBe(1)
    expect(lines.filter(l => l.matchedEntryId).length).toBe(1)
  })

  it('suggests outstanding inbound receipts for statement credits', () => {
    const suggestions = suggestOutstandingPaymentMatches({
      statementLine: { id: 's1', date: '2026-05-10', debit: 0, credit: 4000 },
      payments: [
        {
          id: 'p1',
          amount: 10000,
          allocatedSum: 6000,
          paidAt: '2026-05-09',
          direction: 'inbound',
          notes: 'outstanding:partial',
        },
        {
          id: 'p2',
          amount: 4000,
          allocatedSum: 0,
          paidAt: '2026-05-10',
          direction: 'outbound',
        },
      ],
    })
    expect(suggestions[0]?.paymentId).toBe('p1')
    expect(suggestions[0]?.unallocated).toBe(4000)
  })

  it('sums unmatched bank charges / interest', () => {
    expect(unmatchedBankChargeTotal([
      { id: '1', date: '2026-05-01', debit: 150, credit: 0, category: 'bank_charge' },
      { id: '2', date: '2026-05-01', debit: 50, credit: 0, category: 'bank_charge', matchedEntryId: 'x' },
    ])).toBe(150)
    expect(unmatchedInterestEarnedTotal([
      { id: '3', date: '2026-05-01', debit: 0, credit: 20, category: 'interest_earned' },
    ])).toBe(20)
  })
})

describe('bank adjustment builders', () => {
  it('maps bank charge and interest roles', () => {
    expect(COA_ROLE_CODES.bank_charges).toBe('6401')
    expect(COA_ROLE_CODES.interest_income).toBe('5105')
    expect(labelForRole('bank_charges')).toContain('6401')
  })

  it('builds balanced bank charge / interest lines', () => {
    const charge = buildBankChargeLines({ amount: 250, bankAccountId: 'absa' })
    const resolved = charge.map(l => ({
      account: resolvePostingAccountLabel(l),
      debit: Number(l.debit || 0),
      credit: Number(l.credit || 0),
    }))
    expect(() => assertPostingBalanced(resolved)).not.toThrow()
    expect(resolved[0].account).toBe('6401 - Bank Charges')
    expect(resolved[1].account).toBe('2201 - ABSA Bank')

    const interest = buildBankInterestLines({ amount: 80, bankAccountId: 'equity' })
    expect(resolvePostingAccountLabel(interest[0])).toBe('2202 - Equity Bank')
    expect(resolvePostingAccountLabel(interest[1])).toBe('5105 - Interest Income')
  })
})
