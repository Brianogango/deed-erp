import { describe, expect, it } from 'vitest'
import { evaluateCustomerCreditGate } from '@/lib/customer-credit-gate'

describe('evaluateCustomerCreditGate', () => {
  const overdue = {
    overdueBalance: 25000,
    overdueCount: 1,
    creditLimit: 0,
    outstandingBalance: 25000,
    newOrderTotal: 8000,
  }

  it('lets a quotation be saved when the customer only has overdue invoices', () => {
    const gate = evaluateCustomerCreditGate({ ...overdue, document: 'quote' })
    expect(gate.ok).toBe(true)
    expect(gate.isLocked).toBe(true)
    expect(gate.message).toMatch(/quotation can be saved/i)
  })

  it('blocks sale-order confirm while invoices are overdue', () => {
    const gate = evaluateCustomerCreditGate({ ...overdue, document: 'order' })
    expect(gate.ok).toBe(false)
    expect(gate.message).toMatch(/account locked/i)
  })

  it('blocks invoice create while invoices are overdue', () => {
    const gate = evaluateCustomerCreditGate({ ...overdue, document: 'invoice' })
    expect(gate.ok).toBe(false)
    expect(gate.message).toMatch(/account locked/i)
  })

  it('still blocks a quotation when the credit limit would be exceeded', () => {
    const gate = evaluateCustomerCreditGate({
      overdueBalance: 0,
      overdueCount: 0,
      creditLimit: 10000,
      outstandingBalance: 8000,
      newOrderTotal: 5000,
      document: 'quote',
    })
    expect(gate.ok).toBe(false)
    expect(gate.creditLimitExceeded).toBe(true)
  })
})
