import { describe, it, expect } from 'vitest'
import { riderFeeAccount, riderPayForJob, paidDirectToRider } from '@/lib/delivery/rider-direct-pay'
import { riderWeeks } from '@/lib/delivery/rider-portal'
import { paymentMethodEnum } from '@/lib/accounting/payment-allocations'

describe('customer paid the rider directly', () => {
  it('nets it off the trip pay', () => {
    expect(riderPayForJob({ riderFee: 400 })).toBe(400)
    expect(riderPayForJob({ riderFee: 400, customerPaidRider: { amount: 300 } })).toBe(100)
    expect(riderPayForJob({ riderFee: 300, customerPaidRider: { amount: 500 } })).toBe(-200)
    expect(paidDirectToRider({ riderFee: 300 })).toBe(0)
  })

  it('books to the delivery expense the chart has, and stores as a non-cash method', () => {
    expect(riderFeeAccount(['6401']).label).toBe('6401 - Selling and Delivery')
    expect(riderFeeAccount(['6401', '6519']).code).toBe('6519')
    expect(paymentMethodEnum('paid_to_rider')).toBe('credit')
  })

  it('the rider sees what customers paid them', () => {
    const job = { id: 'j', riderId: 'r1', status: 'delivered', riderFee: 400, deliveredAt: '2026-11-04T09:00:00Z', createdAt: '2026-11-03T09:00:00Z', customerPaidRider: { amount: 300 } }
    const [w] = riderWeeks('r1', [job as any], [], 1, '2026-11-05T09:00:00Z')
    expect(w).toMatchObject({ earned: 400, paidByCustomers: 300 })
  })
})
