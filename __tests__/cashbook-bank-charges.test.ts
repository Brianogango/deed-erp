import { describe, expect, it } from 'vitest'
import { buildCashbookEntries, bankAdjustmentEntryId } from '@/components/modules/Cashbook'
import { buildCashbookMonthSummary } from '@/lib/accounting/cashbook-summary'

const line = (o: Record<string, any>) => ({
  id: 'l1', bankAccountId: 'ncba', month: '2026-10', date: '2026-10-15', description: 'Ledger fee', reference: 'FEE1',
  debit: 350, credit: 0, category: 'bank_charge', ...o,
}) as any

describe('bank charges booked from the reconciliation', () => {
  const base = { invoices: [], posOrders: [], expenses: [], journalEntries: [], deposits: [] }

  it('a booked charge becomes money out in the cashbook; an unbooked one does not', () => {
    const entries = buildCashbookEntries({ ...base, bankStatementLines: [
      line({ bookedAs: 'bank_charge', bookedJournalRef: 'JRN/BNK/bank_charge/l1', bookedBy: 'Jane' }),
      line({ id: 'l2' }),
    ] }, [])
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: bankAdjustmentEntryId('l1'), debit: 350, credit: 0, category: 'Bank charges', bankAccountId: 'ncba', recordedBy: 'Jane' })
  })

  it('interest is money in', () => {
    const [e] = buildCashbookEntries({ ...base, bankStatementLines: [
      line({ category: 'interest_earned', debit: 0, credit: 120, bookedAs: 'interest_earned', bookedJournalRef: 'JRN/BNK/interest_earned/l1' }),
    ] }, [])
    expect(e).toMatchObject({ credit: 120, debit: 0, category: 'Interest earned' })
  })

  it('the month summary lists bank charges under money out', () => {
    const entries = buildCashbookEntries({ ...base, bankStatementLines: [line({ bookedAs: 'bank_charge', bookedJournalRef: 'x' })] }, [])
    const s = buildCashbookMonthSummary({ entries, month: '2026-10', bankAccounts: [{ id: 'ncba', label: 'NCBA', openingBalance: 0 }] })
    expect(s.moneyOutRows).toEqual([{ key: 'bank_charge', label: 'Bank charges', amount: 350, count: 1 }])
  })
})
