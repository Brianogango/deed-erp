import { describe, expect, it } from 'vitest'
import { poStatusView } from '@/lib/purchase/po-status'

const po = (status: string, received: number) => ({ id: 'po1', status, lines: [{ qty: 1, qtyReceived: received }] })
const ret = [{ poId: 'po1', status: 'confirmed' }]

describe('purchase order status after a return', () => {
  it('everything returned reads "Returned to vendor", not partially received', () => {
    expect(poStatusView(po('partial', 0), ret)).toMatchObject({ key: 'returned', label: 'Returned to vendor', fullyReturned: true })
    expect(poStatusView(po('confirmed', 0), ret)).toMatchObject({ key: 'returned' })
  })
  it('some kept reads "Partly returned"', () => {
    expect(poStatusView({ id: 'po1', status: 'partial', lines: [{ qty: 2, qtyReceived: 1 }] }, ret).label).toBe('Partly returned')
  })
  it('a closed order after a full return says so', () => {
    expect(poStatusView(po('cancelled', 0), ret).label).toBe('Closed (returned)')
  })
  it('no return: the usual labels', () => {
    expect(poStatusView(po('partial', 0), []).label).toBe('Partially Received')
    expect(poStatusView(po('received', 1), []).label).toBe('Fully Received')
    expect(poStatusView(po('confirmed', 0), [{ poId: 'other', status: 'confirmed' }]).label).toBe('Purchase Order')
  })
  it('a draft return does not change the label', () => {
    expect(poStatusView(po('partial', 0), [{ poId: 'po1', status: 'draft' }]).label).toBe('Partially Received')
  })
})
