import { describe, it, expect } from 'vitest'
import {
  computeConfirmBackorderLines,
  reservedQtyElsewhere,
  validateSalesOrderCreation,
} from '@/lib/sales-approvals'

const product = { id: 'elite', name: 'HP EliteBook 830 G8', stockQty: 1, unit: 'unit', requiresSerial: true }

describe('backorder stock check excludes self-reservation', () => {
  it('counts other reservations but not this document', () => {
    const reservations = [
      { productId: 'elite', status: 'reserved', qty: 1, referenceId: 'so-self' },
      { productId: 'elite', status: 'reserved', qty: 1, referenceId: 'so-other' },
    ]
    expect(reservedQtyElsewhere(reservations, 'elite', 'so-self')).toBe(1)
    expect(reservedQtyElsewhere(reservations, 'elite')).toBe(2)
  })

  it('does not require backorder when the only reservation belongs to this SO', () => {
    const lines = [{ productId: 'elite', productName: product.name, qty: 1 }]
    const reservations = [
      { productId: 'elite', status: 'reserved', qty: 1, referenceId: 'so-self' },
    ]
    const result = validateSalesOrderCreation(
      lines,
      [product],
      reservations,
      { allowBackorders: true, allowSaleWithoutStock: false },
      { excludeReferenceId: 'so-self', freeQtyByProductId: { elite: 1 } },
    )
    expect(result.requiresApproval).toBe(false)
    expect(computeConfirmBackorderLines(lines, [product], reservations, {
      excludeReferenceId: 'so-self',
      freeQtyByProductId: { elite: 1 },
    })).toEqual([])
  })

  it('still requires backorder when another SO holds the only unit', () => {
    const lines = [{ productId: 'elite', productName: product.name, qty: 1 }]
    const reservations = [
      { productId: 'elite', status: 'reserved', qty: 1, referenceId: 'so-other' },
    ]
    const result = validateSalesOrderCreation(
      lines,
      [product],
      reservations,
      { allowBackorders: true, allowSaleWithoutStock: false },
      { excludeReferenceId: 'so-self', freeQtyByProductId: { elite: 1 } },
    )
    expect(result.requiresApproval).toBe(true)
    expect(result.approvalReasons[0]).toContain('Backorder required')
    expect(computeConfirmBackorderLines(lines, [product], reservations, {
      excludeReferenceId: 'so-self',
      freeQtyByProductId: { elite: 1 },
    })[0]?.qtyBackordered).toBe(1)
  })

  it('uses free sellable qty (not on-hand) for serial products', () => {
    // On-hand 1 (assigned elsewhere) but free sellable 0 → backorder
    const lines = [{ productId: 'elite', productName: product.name, qty: 1 }]
    const result = validateSalesOrderCreation(
      lines,
      [{ ...product, stockQty: 1 }],
      [],
      { allowBackorders: true, allowSaleWithoutStock: false },
      { freeQtyByProductId: { elite: 0 } },
    )
    expect(result.requiresApproval).toBe(true)
  })
})
