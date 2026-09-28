import { describe, expect, it } from 'vitest'
import {
  consignmentsForVendor,
  missingAssetId,
  openConsignments,
  purchaseConsignment,
  recordConsignmentReceipt,
  returnConsignment,
  summariseConsignments,
  type ConsignmentDevice,
} from '@/lib/inventory/consignment'

const device = (over: Partial<ConsignmentDevice> = {}): ConsignmentDevice => ({
  id: 'con-1',
  vendorId: 'vendor-cak',
  vendorName: 'Computer Aid Kenya',
  assetId: 'CAK-00412',
  serialNumber: '5CG1060M8D',
  productName: 'HP EliteBook 840 G3',
  receivedAt: '2026-09-20',
  status: 'at_shop',
  ...over,
})

const receipt = (over: Record<string, unknown> = {}) => ({
  vendorId: 'vendor-cak',
  vendorName: 'Computer Aid Kenya',
  assetId: 'CAK-00412',
  serialNumber: '5CG1060M8D',
  productName: 'HP EliteBook 840 G3',
  receivedAt: '2026-09-20',
  ...over,
})

describe('booking a vendor device in', () => {
  it('records vendor, serial, asset tag and date', () => {
    const r = recordConsignmentReceipt(receipt(), [], 'con-1')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toMatchObject({
        vendorId: 'vendor-cak',
        assetId: 'CAK-00412',
        serialNumber: '5CG1060M8D',
        receivedAt: '2026-09-20',
        status: 'at_shop',
      })
    }
  })

  it('insists on a vendor — otherwise nobody knows whose machine it is', () => {
    const r = recordConsignmentReceipt(receipt({ vendorId: '' }), [], 'con-1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('vendor')
  })

  it('insists on a serial — otherwise it cannot be identified at collection', () => {
    const r = recordConsignmentReceipt(receipt({ serialNumber: '  ' }), [], 'con-1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('serial')
  })

  it('insists on the arrival date, which is the custody trail', () => {
    expect(recordConsignmentReceipt(receipt({ receivedAt: null }), [], 'con-1').ok).toBe(false)
  })

  it('accepts a device with no asset tag rather than turning it away', () => {
    // It is physically in the shop either way; better on the register untagged
    // than absent from it.
    const r = recordConsignmentReceipt(receipt({ assetId: '' }), [], 'con-1')
    expect(r.ok).toBe(true)
    if (r.ok) expect(missingAssetId(r.value)).toBe(true)
  })

  it('refuses the same machine twice while it is still here', () => {
    const r = recordConsignmentReceipt(receipt(), [device()], 'con-2')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('already booked in')
  })

  it('ignores serial case, because vendors are inconsistent about it', () => {
    const r = recordConsignmentReceipt(receipt({ serialNumber: '5cg1060m8d' }), [device()], 'con-2')
    expect(r.ok).toBe(false)
  })

  it('allows a machine back in once it has been collected', () => {
    const gone = device({ status: 'returned', returnedAt: '2026-09-25' })
    expect(recordConsignmentReceipt(receipt(), [gone], 'con-2').ok).toBe(true)
  })
})

describe('buying one', () => {
  it('marks it purchased with the date and the purchase order', () => {
    const r = purchaseConsignment(device(), { at: '2026-09-28', purchaseOrderId: 'po-7', price: 32000 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toMatchObject({
        status: 'purchased',
        purchasedAt: '2026-09-28',
        purchaseOrderId: 'po-7',
        purchasePrice: 32000,
      })
    }
  })

  it('will not buy the same machine twice', () => {
    expect(purchaseConsignment(device({ status: 'purchased' }), { at: '2026-09-28' }).ok).toBe(false)
  })

  it('will not buy one the vendor has already collected', () => {
    const r = purchaseConsignment(device({ status: 'returned' }), { at: '2026-09-28' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('no longer here')
  })

  it('insists on a purchase date', () => {
    expect(purchaseConsignment(device(), { at: '' }).ok).toBe(false)
  })

  it('rejects a negative price', () => {
    expect(purchaseConsignment(device(), { at: '2026-09-28', price: -5 }).ok).toBe(false)
  })

  it('allows a purchase with no price recorded yet', () => {
    const r = purchaseConsignment(device(), { at: '2026-09-28' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.purchasePrice).toBeNull()
  })
})

describe('the vendor collecting one', () => {
  it('checks it out with the date', () => {
    const r = returnConsignment(device(), { at: '2026-09-27' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toMatchObject({ status: 'returned', returnedAt: '2026-09-27' })
  })

  it('keeps any note alongside what was already recorded', () => {
    const r = returnConsignment(device({ notes: 'Screen scuffed on arrival' }), { at: '2026-09-27', notes: 'Collected by John' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.notes).toBe('Screen scuffed on arrival\nCollected by John')
  })

  it('refuses to hand back a machine Deed has bought', () => {
    const r = returnConsignment(device({ status: 'purchased' }), { at: '2026-09-27' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain("Deed's stock")
  })

  it('will not collect the same machine twice', () => {
    expect(returnConsignment(device({ status: 'returned' }), { at: '2026-09-27' }).ok).toBe(false)
  })

  it('insists on the collection date', () => {
    expect(returnConsignment(device(), { at: '' }).ok).toBe(false)
  })
})

describe('what is on the floor', () => {
  const floor = [
    device({ id: 'a', serialNumber: 'AAA', receivedAt: '2026-09-20' }),
    device({ id: 'b', serialNumber: 'BBB', receivedAt: '2026-09-10', assetId: null }),
    device({ id: 'c', serialNumber: 'CCC', vendorId: 'vendor-x', vendorName: 'Other Vendor' }),
    device({ id: 'd', serialNumber: 'DDD', status: 'purchased' }),
    device({ id: 'e', serialNumber: 'EEE', status: 'returned' }),
  ]

  it('counts only devices still here', () => {
    expect(openConsignments(floor).map(d => d.id)).toEqual(['a', 'b', 'c'])
  })

  it('filters to one vendor', () => {
    expect(consignmentsForVendor('vendor-cak', floor).map(d => d.id)).toEqual(['a', 'b'])
  })

  it('returns nothing for an unknown vendor rather than everything', () => {
    expect(consignmentsForVendor('', floor)).toEqual([])
  })

  it('summarises per vendor, busiest first, flagging untagged machines', () => {
    const summary = summariseConsignments(floor)
    expect(summary).toEqual([
      { vendorId: 'vendor-cak', vendorName: 'Computer Aid Kenya', atShop: 2, untagged: 1, oldestReceivedAt: '2026-09-10' },
      { vendorId: 'vendor-x', vendorName: 'Other Vendor', atShop: 1, untagged: 0, oldestReceivedAt: '2026-09-20' },
    ])
  })

  it('reports the oldest arrival, which is what has been sitting longest', () => {
    expect(summariseConsignments(floor)[0]!.oldestReceivedAt).toBe('2026-09-10')
  })
})
