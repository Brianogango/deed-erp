import { describe, expect, it } from 'vitest'
import {
  buildSerialPoolsByProduct,
  pairOrderLinesWithDeliveryLines,
  planPrepareDeliveryLines,
  sumQtyByProductId,
} from '@/lib/delivery-prepare'

const thinkpad = 'prod-thinkpad'
const mouse = 'prod-mouse'

describe('delivery prepare with duplicate product lines', () => {
  it('sums qty by product instead of keeping only the last line', () => {
    expect(sumQtyByProductId([
      { productId: thinkpad, qty: 1 },
      { productId: thinkpad, qty: 2 },
      { productId: thinkpad, qty: 1 },
      { productId: mouse, qty: 4 },
    ])).toEqual({ [thinkpad]: 4, [mouse]: 4 })
  })

  it('pools serials from every SO line for the same product', () => {
    const pools = buildSerialPoolsByProduct([
      { productId: thinkpad, qty: 1, serialIds: ['s1'] },
      { productId: thinkpad, qty: 2, serialIds: ['s2', 's3'] },
      { productId: thinkpad, qty: 1, serialIds: ['s4'] },
    ])
    expect(pools.get(thinkpad)).toEqual(['s1', 's2', 's3', 's4'])
  })

  it('assigns serials across duplicate ThinkPad delivery rows (the 2/2 bug)', () => {
    const result = planPrepareDeliveryLines({
      deliveryLines: [
        { productId: thinkpad, productName: 'ThinkPad T495s', qty: 1 },
        { productId: thinkpad, productName: 'ThinkPad T495s', qty: 2 },
        { productId: thinkpad, productName: 'ThinkPad T495s', qty: 1 },
        { productId: mouse, productName: 'Mouse', qty: 4 },
      ],
      soLines: [
        { productId: thinkpad, qty: 1, serialIds: ['PC19P6B6'] },
        { productId: thinkpad, qty: 2, serialIds: ['PC1AVLYS', 'PC19P3VZ'] },
        { productId: thinkpad, qty: 1, serialIds: ['PC1D8D2N'] },
        { productId: mouse, qty: 4, serialIds: [] },
      ],
      requestedByProduct: { [thinkpad]: 4, [mouse]: 4 },
      isSerialTracked: (id) => id === thinkpad,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lines[0].serialIds).toEqual(['PC19P6B6'])
    expect(result.lines[1].serialIds).toEqual(['PC1AVLYS', 'PC19P3VZ'])
    expect(result.lines[2].serialIds).toEqual(['PC1D8D2N'])
    expect(result.lines[3]).toMatchObject({ qty: 4, serialIds: [] })
  })

  it('pairs each SO ThinkPad row to its own DN row by qty', () => {
    const pairs = pairOrderLinesWithDeliveryLines(
      [
        { id: 'a', productId: thinkpad, qty: 1 },
        { id: 'b', productId: thinkpad, qty: 2 },
        { id: 'c', productId: thinkpad, qty: 1 },
      ],
      [
        { productId: thinkpad, qty: 1, qtyDone: 1 },
        { productId: thinkpad, qty: 2, qtyDone: 2 },
        { productId: thinkpad, qty: 1, qtyDone: 1 },
      ],
    )
    expect(pairs[0].deliveryLine).toMatchObject({ qty: 1, qtyDone: 1 })
    expect(pairs[1].deliveryLine).toMatchObject({ qty: 2, qtyDone: 2 })
    expect(pairs[2].deliveryLine).toMatchObject({ qty: 1, qtyDone: 1 })
  })

  it('still errors when not enough serials are assigned overall', () => {
    const result = planPrepareDeliveryLines({
      deliveryLines: [
        { productId: thinkpad, productName: 'ThinkPad T495s', qty: 2 },
      ],
      soLines: [
        { productId: thinkpad, qty: 2, serialIds: ['only-one'] },
      ],
      requestedByProduct: { [thinkpad]: 2 },
      isSerialTracked: () => true,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('Assign 2 serial')
  })
})
