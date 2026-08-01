import { describe, expect, it } from 'vitest'
import { planRepairPartConsume, planRepairPartReserve } from '@/lib/inventory/repair-parts-stock'

describe('repair parts stock planners', () => {
  it('plans bulk transfer into repair_unit on reserve', () => {
    const { steps, errors } = planRepairPartReserve({
      repairRef: 'RO/1',
      lines: [{ productId: 'p1', productName: 'SSD', qty: 2, requiresSerial: false }],
      stockFor: () => ({ warehouse: 5, shop: 1, repair_unit: 0 }),
      availableSerialsFor: () => [],
    })
    expect(errors).toHaveLength(0)
    expect(steps).toEqual([
      {
        kind: 'transfer_bulk',
        productId: 'p1',
        productName: 'SSD',
        qty: 1,
        from: 'shop',
        to: 'repair_unit',
        reason: 'Parts reserved — repair RO/1',
      },
      {
        kind: 'transfer_bulk',
        productId: 'p1',
        productName: 'SSD',
        qty: 1,
        from: 'warehouse',
        to: 'repair_unit',
        reason: 'Parts reserved — repair RO/1',
      },
    ])
  })

  it('consumes from repair_unit before shop/warehouse', () => {
    const { steps, errors } = planRepairPartConsume({
      repairRef: 'RO/1',
      lines: [{ productId: 'p1', productName: 'SSD', qty: 2, requiresSerial: false }],
      stockFor: () => ({ warehouse: 10, shop: 10, repair_unit: 2 }),
      assignedSerialsFor: () => [],
    })
    expect(errors).toHaveLength(0)
    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({ kind: 'consume_bulk', from: 'repair_unit', qty: 2 })
  })
})
