import { describe, expect, it } from 'vitest'
import { EXCHANGE_RETURN_LOCATION } from '@/lib/aftersales/exchange-stock'

describe('exchange return stock destination', () => {
  it('sends completed exchange returns to With Issues (shop)', () => {
    // shop = With Issues in LOCATIONS; warehouse = Ready for Sale.
    expect(EXCHANGE_RETURN_LOCATION).toBe('shop')
  })
})
