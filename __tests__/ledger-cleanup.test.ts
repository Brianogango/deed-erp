import { describe, expect, it } from 'vitest'
import { planCreditApplicationDuplicates, planDepositDuplicates } from '@/lib/accounting/ledger-cleanup'

const e = (ref: string, sourceType: string, amount: number) => ({ ref, sourceType, amount, date: '2026-09-20' })

describe('planDepositDuplicates', () => {
  it('reverses the browser copy of a deposit receipt and keeps the server entry', () => {
    const plan = planDepositDuplicates([
      e('JRN/DEP/DEP/0001/3ed2ba70-1111-2222-3333-444455556666', 'deposit_receipt', 5000),
      e('JRN/DEP/DEP/0001/3ed2ba70', 'manual', 5000),
      e('JRN/DEP/DEP/0001/90a862c4-1111-2222-3333-444455556666', 'deposit_receipt', 10000),
      e('JRN/DEP/DEP/0001/06be84fc', 'manual', 10000),
    ])
    expect(plan).toEqual([
      { ref: 'JRN/DEP/DEP/0001/3ed2ba70', amount: 5000, date: '2026-09-20', keeps: 'JRN/DEP/DEP/0001/3ed2ba70-1111-2222-3333-444455556666' },
      // The browser copy carried its own id: paired by deposit and amount.
      { ref: 'JRN/DEP/DEP/0001/06be84fc', amount: 10000, date: '2026-09-20', keeps: 'JRN/DEP/DEP/0001/90a862c4-1111-2222-3333-444455556666' },
    ])
  })

  it('leaves a browser entry alone when the server has no matching entry or amount', () => {
    expect(planDepositDuplicates([e('JRN/DEP/DEP/0002/aaaaaaaa', 'manual', 1000)])).toEqual([])
    expect(planDepositDuplicates([
      e('JRN/DEP/DEP/0002/aaaaaaaa-1', 'deposit_receipt', 900),
      e('JRN/DEP/DEP/0002/aaaaaaaa', 'manual', 1000),
    ])).toEqual([])
  })

  it('matches a browser refund to the server refund', () => {
    const plan = planDepositDuplicates([
      e('JRN/DEP/REFUND/DEP/0001/abc', 'deposit_refund', 1000),
      e('JRN/REFUND/DEP/0001', 'manual', 1000),
    ])
    expect(plan.map(p => p.ref)).toEqual(['JRN/REFUND/DEP/0001'])
  })

  it('never pairs one server entry with two browser copies', () => {
    const plan = planDepositDuplicates([
      e('JRN/DEP/DEP/0003/bbbbbbbb-1', 'deposit_receipt', 500),
      e('JRN/DEP/DEP/0003/bbbbbbbb', 'manual', 500),
      e('JRN/DEP/DEP/0003/BBBBBBBB', 'manual', 500),
    ])
    expect(plan).toHaveLength(1)
  })
})

describe('planCreditApplicationDuplicates', () => {
  it('reverses the browser copy of a credit application the server also booked', () => {
    const plan = planCreditApplicationDuplicates(
      [{ ref: 'JRN/CAPP/INV/2026/0262/1790267362522', invoiceId: 'i-262', amount: 15000 }],
      [{ ref: 'JRN/PAY/INV/2026/0262/73c5fc16', invoiceId: 'i-262', amount: 15000 }],
    )
    expect(plan.reverse).toEqual([{ ref: 'JRN/CAPP/INV/2026/0262/1790267362522', invoiceId: 'i-262', amount: 15000, keeps: 'JRN/PAY/INV/2026/0262/73c5fc16' }])
    expect(plan.unpaired).toEqual([])
  })

  it('leaves a browser copy with no server twin (it may be the only booking)', () => {
    const plan = planCreditApplicationDuplicates(
      [{ ref: 'JRN/CAPP/INV/1/1', invoiceId: 'i-1', amount: 500 }, { ref: 'JRN/CAPP/INV/1/2', invoiceId: 'i-1', amount: 500 }],
      [{ ref: 'JRN/PAY/INV/1/a', invoiceId: 'i-1', amount: 500 }],
    )
    expect(plan.reverse.map(r => r.ref)).toEqual(['JRN/CAPP/INV/1/1'])
    expect(plan.unpaired.map(r => r.ref)).toEqual(['JRN/CAPP/INV/1/2'])
  })
})
