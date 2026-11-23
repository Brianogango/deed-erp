import { describe, it, expect } from 'vitest'
import { advanceIdFromRefundNote, advanceNote, advanceOpen, planAdvanceApplication, poIdFromAdvanceNote, refundNote } from '@/lib/purchase/vendor-advance-core'
import { assertBillableQty, billableQty } from '@/lib/purchase/three-way-match'

const PO = '11111111-1111-4111-8111-111111111111'
const ADV = '22222222-2222-4222-8222-222222222222'

describe('advance notes link payments to their order', () => {
  it('round-trips the order and advance ids', () => {
    expect(poIdFromAdvanceNote(advanceNote(PO, 'PO/0001'))).toBe(PO)
    expect(advanceIdFromRefundNote(refundNote(ADV, 'PO/0001'))).toBe(ADV)
    expect(poIdFromAdvanceNote('method:vendor_credit')).toBeNull()
  })
})

describe('what an advance still has', () => {
  it('is paid − used − refunded, never below zero', () => {
    expect(advanceOpen(100000, 60000, 0)).toBe(40000)
    expect(advanceOpen(100000, 60000, 40000)).toBe(0)
    expect(advanceOpen(100, 150, 0)).toBe(0)
  })
})

describe('using advances on a bill', () => {
  it('takes the oldest first and never more than the bill owes', () => {
    const plan = planAdvanceApplication(70000, [
      { id: 'b', open: 50000, paidAt: '2026-11-10' },
      { id: 'a', open: 30000, paidAt: '2026-11-01' },
    ])
    expect(plan).toEqual([{ id: 'a', amount: 30000 }, { id: 'b', amount: 40000 }])
  })
  it('a smaller advance leaves the rest of the bill to pay', () => {
    expect(planAdvanceApplication(100000, [{ id: 'a', open: 50000, paidAt: '2026-11-01' }])).toEqual([{ id: 'a', amount: 50000 }])
  })
})

describe('billing a paid order before delivery', () => {
  const line = { qty: 10, qtyOrdered: 10, qtyReceived: 0, qtyBilled: 0 }
  it('without an advance, only received goods can be billed', () => {
    expect(billableQty(line)).toBe(0)
    expect(() => assertBillableQty(line, 1)).toThrow(/received and unbilled/)
  })
  it('with an advance, the ordered quantity can be billed — and no more', () => {
    expect(billableQty({ ...line, prepaid: true })).toBe(10)
    expect(() => assertBillableQty({ ...line, prepaid: true }, 10)).not.toThrow()
    expect(() => assertBillableQty({ ...line, prepaid: true, qtyBilled: 4 }, 7)).toThrow(/ordered and unbilled/)
  })
  it('over-receipt on a paid order still bills what came in', () => {
    expect(billableQty({ ...line, qtyReceived: 12, prepaid: true })).toBe(12)
  })
})
