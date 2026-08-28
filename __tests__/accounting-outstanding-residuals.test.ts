import { describe, expect, it } from 'vitest'
import {
  isOutstandingPayment,
  paymentAllocationState,
  paymentAllocatedSum,
  paymentUnallocated,
} from '@/lib/accounting/residuals'
import {
  assertPostingBalanced,
  buildAllocateOutstandingLines,
  buildPaymentWithOutstandingLines,
  resolvePostingAccountLabel,
} from '@/lib/accounting/posting-service'
import { COA_ROLE_CODES, labelForRole } from '@/lib/accounting/coa-roles'

describe('payment outstanding residuals', () => {
  it('computes unallocated cash on a receipt', () => {
    expect(paymentUnallocated(10000, 6000)).toBe(4000)
    expect(paymentUnallocated(1000, 1000)).toBe(0)
    expect(paymentAllocatedSum([{ amount: 100 }, { amount: 50.555 }])).toBe(150.56)
  })

  it('derives allocation state', () => {
    expect(paymentAllocationState({ amount: 500, allocatedSum: 0 })).toBe('unallocated')
    expect(paymentAllocationState({ amount: 500, allocatedSum: 200 })).toBe('partial')
    expect(paymentAllocationState({ amount: 500, allocatedSum: 500 })).toBe('fully_allocated')
    expect(paymentAllocationState({ amount: 500, allocatedSum: 0, isVoided: true })).toBe('void')
    expect(isOutstandingPayment({ amount: 500, allocatedSum: 100 })).toBe(true)
    expect(isOutstandingPayment({ amount: 500, allocatedSum: 500 })).toBe(false)
  })
})

describe('outstanding clearing CoA roles', () => {
  it('maps outstanding receipts/payments to live clearing codes', () => {
    expect(COA_ROLE_CODES.outstanding_receipts).toBe('1933')
    expect(COA_ROLE_CODES.outstanding_payments).toBe('3202')
    expect(labelForRole('outstanding_receipts')).toBe('1933 - Outstanding Receipts')
  })
})

describe('outstanding posting builders', () => {
  it('parks unallocated customer receipt on 1933', () => {
    const lines = buildPaymentWithOutstandingLines({
      partnerName: 'Acme',
      paymentRef: 'RCPT-1',
      method: 'bank_transfer',
      allocations: [{ invoiceRef: 'INV-1', amount: 600 }],
      unallocatedAmount: 400,
    })
    const resolved = lines.map(l => ({
      account: resolvePostingAccountLabel(l),
      debit: Number(l.debit || 0),
      credit: Number(l.credit || 0),
    }))
    expect(() => assertPostingBalanced(resolved)).not.toThrow()
    expect(resolved.find(l => l.account.includes('2201'))?.debit).toBe(1000)
    expect(resolved.find(l => l.account.includes('1800'))?.credit).toBe(600)
    expect(resolved.find(l => l.account.includes('1933'))?.credit).toBe(400)
  })

  it('clears outstanding onto AR on later allocation', () => {
    const lines = buildAllocateOutstandingLines({
      partnerName: 'Acme',
      paymentRef: 'RCPT-1',
      allocations: [{ invoiceRef: 'INV-2', amount: 400 }],
    })
    const resolved = lines.map(l => ({
      account: resolvePostingAccountLabel(l),
      debit: Number(l.debit || 0),
      credit: Number(l.credit || 0),
    }))
    expect(() => assertPostingBalanced(resolved)).not.toThrow()
    expect(resolved[0].account).toBe('1933 - Outstanding Receipts')
    expect(resolved[1].account).toBe('1800 - Accounts Receivable')
  })

  it('builds vendor outstanding payment (3202)', () => {
    const lines = buildPaymentWithOutstandingLines({
      partnerName: 'Vendor Co',
      paymentRef: 'PAY-9',
      method: 'bank',
      isVendor: true,
      allocations: [],
      unallocatedAmount: 2500,
    })
    const resolved = lines.map(l => ({
      account: resolvePostingAccountLabel(l),
      debit: Number(l.debit || 0),
      credit: Number(l.credit || 0),
    }))
    expect(() => assertPostingBalanced(resolved)).not.toThrow()
    expect(resolved.find(l => l.account.includes('3202'))?.debit).toBe(2500)
  })
})
