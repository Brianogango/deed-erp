import { describe, expect, it } from 'vitest'
import {
  applyConfirmLineSelection,
  canConfirmAndReserve,
  canConfirmQuotation,
  canConfirmWithoutReservation,
  confirmSelectionHasProduct,
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

describe('applyConfirmLineSelection', () => {
  const lines = [
    { id: 'sec', lineType: 'section' as const, productName: 'Hardware', qty: 0 },
    { id: 'a', productId: 'p1', productName: 'Laptop', qty: 2, unitPrice: 10000, taxRate: 16, serialIds: ['s1', 's2'] },
    { id: 'b', productId: 'p2', productName: 'Mouse', qty: 1, unitPrice: 500, taxRate: 16 },
  ]

  it('drops unchecked lines and reduces qty without increasing', () => {
    const result = applyConfirmLineSelection(lines, { a: 1, b: 0 })
    expect(result.droppedIds).toEqual(['b'])
    expect(result.changed).toBe(true)
    expect(result.lines.map(l => l.id)).toEqual(['sec', 'a'])
    expect(result.lines.find(l => l.id === 'a')?.qty).toBe(1)
    expect(result.releasedSerialIds).toEqual(['s2'])
    expect(result.lines.find(l => l.id === 'a')?.serialIds).toEqual(['s1'])
  })

  it('clamps an increase back to the quoted qty', () => {
    const result = applyConfirmLineSelection(lines, { a: 9, b: 1 })
    expect(result.changed).toBe(false)
    expect(result.lines.find(l => l.id === 'a')?.qty).toBe(2)
  })

  it('rejects an empty product selection', () => {
    const result = applyConfirmLineSelection(lines, { a: 0, b: 0 })
    expect(confirmSelectionHasProduct(result.lines)).toBe(false)
    expect(result.lines.some(l => l.lineType === 'section')).toBe(false)
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
