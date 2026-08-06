import { describe, expect, it } from 'vitest'
import {
  canConfirmAndReserve,
  canConfirmQuotation,
  canConfirmWithoutReservation,
  stockShortageLines,
} from '@/lib/sales/confirm-quotation'

describe('confirm quotation permissions', () => {
  it('allows sales roles to confirm quotations', () => {
    expect(canConfirmQuotation('sales_rep')).toBe(true)
    expect(canConfirmQuotation('admin_officer')).toBe(true)
    expect(canConfirmQuotation('director')).toBe(true)
    expect(canConfirmQuotation('inventory_officer')).toBe(false)
    expect(canConfirmQuotation(null)).toBe(false)
  })

  it('gates reserve to inventory approvers', () => {
    expect(canConfirmAndReserve('director')).toBe(true)
    expect(canConfirmAndReserve('inventory_officer')).toBe(true)
    expect(canConfirmAndReserve('admin_officer')).toBe(true)
    expect(canConfirmAndReserve('technical_lead')).toBe(true)
    expect(canConfirmAndReserve('sales_rep')).toBe(false)
  })

  it('gates confirm-without-reservation to director / inventory', () => {
    expect(canConfirmWithoutReservation('director')).toBe(true)
    expect(canConfirmWithoutReservation('inventory_officer')).toBe(true)
    expect(canConfirmWithoutReservation('sales_rep')).toBe(false)
    expect(canConfirmWithoutReservation('admin_officer')).toBe(false)
  })
})

describe('stockShortageLines', () => {
  it('reports lines below free stock and skips sections', () => {
    const lines = [
      { lineType: 'section' as const, productName: 'Laptops', qty: 0 },
      { productId: 'p1', productName: 'Latitude', qty: 2 },
      { productId: 'p2', productName: 'Mouse', qty: 1 },
    ]
    const shortages = stockShortageLines(lines, id => (id === 'p1' ? 0 : 5))
    expect(shortages).toEqual([{ productName: 'Latitude', qty: 2, available: 0 }])
  })
})
