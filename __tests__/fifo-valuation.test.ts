import { describe, expect, it } from 'vitest'
import { consumeBatchesFIFO } from '@/lib/inventory/valuation-math'

describe('consumeBatchesFIFO', () => {
  it('consumes oldest batch layers first', () => {
    const result = consumeBatchesFIFO(
      [
        { id: 'b1', quantityAvailable: 2, unitCost: 100, receivedAt: '2026-01-01' },
        { id: 'b2', quantityAvailable: 3, unitCost: 150, receivedAt: '2026-02-01' },
      ],
      4,
    )

    expect(result.shortfall).toBe(0)
    expect(result.consumed).toEqual([
      { batchId: 'b1', qty: 2, unitCost: 100, totalCost: 200 },
      { batchId: 'b2', qty: 2, unitCost: 150, totalCost: 300 },
    ])
    expect(result.totalCost).toBe(500)
    expect(result.remainingBatches).toEqual([
      { id: 'b2', quantityAvailable: 1, unitCost: 150, receivedAt: '2026-02-01' },
    ])
  })

  it('reports shortfall when insufficient stock', () => {
    const result = consumeBatchesFIFO(
      [{ id: 'b1', quantityAvailable: 1, unitCost: 50, receivedAt: '2026-01-01' }],
      3,
    )
    expect(result.shortfall).toBe(2)
    expect(result.totalCost).toBe(50)
    expect(result.consumed).toHaveLength(1)
  })

  it('returns empty consumption for zero qty', () => {
    const batches = [{ id: 'b1', quantityAvailable: 5, unitCost: 10, receivedAt: '2026-01-01' }]
    const result = consumeBatchesFIFO(batches, 0)
    expect(result.consumed).toEqual([])
    expect(result.totalCost).toBe(0)
    expect(result.remainingBatches).toEqual(batches)
  })
})
