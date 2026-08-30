import { describe, expect, it } from 'vitest'
import { buildCashbookEntries } from '@/components/modules/Cashbook'

const baseState = {
  invoices: [],
  posOrders: [],
  expenses: [],
  journalEntries: [],
  deposits: [],
}

describe('cashbook actual-movement rules', () => {
  it('does not treat approved company expenses as cash paid', () => {
    const entries = buildCashbookEntries({
      ...baseState,
      expenses: [{
        id: 'exp-1',
        ref: 'EXP/0001',
        submittedByUserId: 'u1',
        submittedByName: 'Staff',
        expenseDate: '2026-08-01',
        submittedDate: '2026-08-01',
        category: 'utilities',
        description: 'Electricity',
        amount: 5000,
        paymentMethod: 'mpesa_company',
        status: 'approved',
        createdAt: '2026-08-01',
      } as any],
    }, [])
    expect(entries).toEqual([])
  })

  it('records company expense only after Finance marks it paid', () => {
    const entries = buildCashbookEntries({
      ...baseState,
      expenses: [{
        id: 'exp-2',
        ref: 'EXP/0002',
        submittedByUserId: 'u1',
        submittedByName: 'Staff',
        reviewedByName: 'Finance',
        expenseDate: '2026-08-01',
        submittedDate: '2026-08-01',
        category: 'utilities',
        description: 'Internet',
        amount: 8000,
        paymentMethod: 'company_card',
        status: 'paid',
        paidDate: '2026-08-10',
        paymentBankAccount: 'ncba',
        paymentReference: 'BANK-123',
        createdAt: '2026-08-01',
      } as any],
    }, [])
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      date: '2026-08-10',
      ref: 'BANK-123',
      bankAccountId: 'ncba',
      debit: 8000,
      credit: 0,
      sourceType: 'expense',
    })
  })

  it('does not reduce cash for a posted payroll until a payment journal exists', () => {
    const entries = buildCashbookEntries({
      ...baseState,
      payrollRuns: [{
        id: 'pr-1',
        ref: 'PAY/2026/08',
        month: '08',
        year: 2026,
        status: 'posted',
        totalNet: 100000,
      }],
      purchaseOrders: [{
        id: 'po-1',
        ref: 'PO/2026/0001',
        status: 'received',
        total: 500000,
      }],
    } as any, [])
    expect(entries).toEqual([])
  })

  it('records payroll only from the explicit payroll payment journal', () => {
    const entries = buildCashbookEntries({
      ...baseState,
      journalEntries: [{
        id: 'j-pay-1',
        ref: 'JRN/PAYROLL-PAY/PAY/2026/08',
        date: '2026-08-31',
        source: 'payment',
        description: 'Payroll payment — PAY/2026/08',
        status: 'posted',
        payrollRunId: 'pr-1',
        bankAccountId: 'ncba',
        lines: [],
        totalDebit: 100000,
        totalCredit: 100000,
      } as any],
    }, [])
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      date: '2026-08-31',
      bankAccountId: 'ncba',
      debit: 100000,
      credit: 0,
      sourceType: 'payroll',
      sourceId: 'pr-1',
    })
  })
})
