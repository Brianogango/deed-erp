import { describe, expect, it } from 'vitest'
import { serialNumbersInOrder } from '@/lib/inventory/checkout-serials'

describe('checkout serial labels', () => {
  it('each id gets its own serial number, whatever order the stock list is in (CHK-00025)', () => {
    // Picked in this order…
    const serialIds = ['id-sk', 'id-ms', 'id-p5', 'id-zq']
    // …but the stock list holds them alphabetically.
    const serials = [
      { id: 'id-ms', serial: 'PW03TBMS' }, { id: 'id-p5', serial: 'PW03TBP5' },
      { id: 'id-sk', serial: 'PW03TBSK' }, { id: 'id-zq', serial: 'PW03TBZQ' },
    ]
    expect(serialNumbersInOrder(serialIds, serials)).toEqual(['PW03TBSK', 'PW03TBMS', 'PW03TBP5', 'PW03TBZQ'])
  })

  it('falls back to what the checkout stored when a serial record is gone', () => {
    expect(serialNumbersInOrder(['a', 'b'], [{ id: 'a', serial: 'S-A' }], ['old-a', 'old-b'])).toEqual(['S-A', 'old-b'])
  })
})
