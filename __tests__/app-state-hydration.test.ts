import { describe, expect, it } from 'vitest'
import { appStateKeysForRoute } from '@/lib/app-state-hydration'

describe('appStateKeysForRoute', () => {
  it('hydrates trade-in / buyback keys on purchase routes', () => {
    for (const route of ['/purchase', '/purchases']) {
      const keys = appStateKeysForRoute(route)
      expect(keys).toEqual(expect.arrayContaining([
        'deed_buyBacks',
        'deed_donations',
        'deed_clientExchanges',
        'deed_saleOrders',
      ]))
    }
  })

  it('keeps buyback keys on aftersales routes', () => {
    for (const route of ['/aftersales', '/after_sales']) {
      expect(appStateKeysForRoute(route)).toEqual(expect.arrayContaining([
        'deed_buyBacks',
        'deed_donations',
        'deed_clientExchanges',
      ]))
    }
  })
})
