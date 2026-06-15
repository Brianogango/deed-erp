import { describe, expect, it } from 'vitest'
import { validateSalesOrderCreation } from '@/lib/sales-approvals'

const product = { id: 'prod-1', name: 'Laptop', stockQty: 5, requiresSerial: false }
const rules = {
  allowSaleWithoutStock: false,
  allowBackorders: true,
  requireSerialForTrackedItems: false,
}

describe('validateSalesOrderCreation()', () => {
  it('rejects zero-quantity lines before confirmation', () => {
    const result = validateSalesOrderCreation(
      [{ productId: 'prod-1', productName: 'Laptop', qty: 0 }],
      [product],
      [],
      rules,
    )

    expect(result.canCreate).toBe(false)
    expect(result.issues[0]).toContain('Quantity must be greater than zero')
  })

  it('rejects negative-quantity lines before confirmation', () => {
    const result = validateSalesOrderCreation(
      [{ productId: 'prod-1', productName: 'Laptop', qty: -2 }],
      [product],
      [],
      rules,
    )

    expect(result.canCreate).toBe(false)
    expect(result.issues[0]).toContain('Quantity must be greater than zero')
  })

  it('allows positive quantities when product exists', () => {
    const result = validateSalesOrderCreation(
      [{ productId: 'prod-1', productName: 'Laptop', qty: 1 }],
      [product],
      [],
      rules,
    )

    expect(result.canCreate).toBe(true)
    expect(result.issues).toEqual([])
  })
})
