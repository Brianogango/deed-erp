import { describe, expect, it } from 'vitest'
import { collectedOnInvoice } from '@/lib/accounting/dashboard-metrics'

describe('collectedOnInvoice', () => {
  it('uses allocation rows when they exist', () => {
    expect(collectedOnInvoice({
      amountPaid: 0,
      paymentAllocations: [{ amount: 400 }, { amount: 100 }],
    })).toBe(500)
  })

  it('falls back to amountPaid when there are no allocation rows', () => {
    expect(collectedOnInvoice({
      amountPaid: 1_200,
      paymentAllocations: [],
    })).toBe(1_200)
  })

  it('treats missing allocations as a legacy paid cache', () => {
    expect(collectedOnInvoice({ amountPaid: 80 })).toBe(80)
  })
})
