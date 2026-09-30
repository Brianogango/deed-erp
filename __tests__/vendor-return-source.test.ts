import { describe, expect, it } from 'vitest'
import { pickVendorReturnSources, vendorReturnPickOrder } from '@/lib/inventory/vendor-return-source'

describe('where returned goods come from', () => {
  it('takes damaged goods from the faulty stages before sellable stock', () => {
    expect(vendorReturnPickOrder('damaged')).toEqual(['quarantine', 'shop', 'pending_testing', 'warehouse'])
    const r = pickVendorReturnSources({ warehouse: 5, shop: 2, quarantine: 1 }, 3, 'damaged')
    expect(r).toEqual({ ok: true, picks: [{ location: 'quarantine', qty: 1 }, { location: 'shop', qty: 2 }] })
  })

  it('takes excess and wrong supply from good stock first', () => {
    const r = pickVendorReturnSources({ warehouse: 5, shop: 2 }, 3, 'excess')
    expect(r).toEqual({ ok: true, picks: [{ location: 'warehouse', qty: 3 }] })
    expect(vendorReturnPickOrder('wrong_supply')[0]).toBe('warehouse')
  })

  it('never takes from Refurbishment, and says how many are on hand when short', () => {
    expect(pickVendorReturnSources({ repair_unit: 10, shop: 1 }, 2, 'damaged')).toEqual({ ok: false, available: 1 })
  })
})
