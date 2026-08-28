import { describe, expect, it } from 'vitest'
import { consumeBatchesFIFO, restoreBatchesFIFO } from '@/lib/inventory/valuation-math'

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

describe('restoreBatchesFIFO', () => {
  it('puts qty back onto the newest consumed layer first', () => {
    const result = restoreBatchesFIFO(
      [
        { id: 'b1', quantityAvailable: 0, quantityReceived: 2, unitCost: 100, receivedAt: '2026-01-01' },
        { id: 'b2', quantityAvailable: 1, quantityReceived: 3, unitCost: 150, receivedAt: '2026-02-01' },
      ],
      2,
    )

    expect(result.leftover).toBe(0)
    expect(result.restored).toEqual([
      { batchId: 'b2', qty: 2 },
    ])
    expect(result.remainingBatches.find(b => b.id === 'b2')?.quantityAvailable).toBe(3)
    expect(result.remainingBatches.find(b => b.id === 'b1')?.quantityAvailable).toBe(0)
  })

  it('spills onto older layers when the newest is full', () => {
    const result = restoreBatchesFIFO(
      [
        { id: 'b1', quantityAvailable: 0, quantityReceived: 2, unitCost: 100, receivedAt: '2026-01-01' },
        { id: 'b2', quantityAvailable: 2, quantityReceived: 3, unitCost: 150, receivedAt: '2026-02-01' },
      ],
      2,
    )

    expect(result.leftover).toBe(0)
    expect(result.restored).toEqual([
      { batchId: 'b2', qty: 1 },
      { batchId: 'b1', qty: 1 },
    ])
  })

  it('reports leftover when consumed room is insufficient', () => {
    const result = restoreBatchesFIFO(
      [{ id: 'b1', quantityAvailable: 1, quantityReceived: 1, unitCost: 50, receivedAt: '2026-01-01' }],
      2,
    )
    expect(result.leftover).toBe(2)
    expect(result.restored).toEqual([])
  })
})
