import { describe, expect, it } from 'vitest'
import {
  formatStockByLocation,
  freeQtyAtLocation,
  resolveBulkDeliverySourceLocation,
} from '@/lib/inventory/delivery-source'

describe('delivery-source', () => {
  const product = { requiresSerial: false, trackingMethod: 'QUANTITY' }
  const bulkStock = [
    { productId: 'hdd', location: 'shop' as const, qty: 2 },
    { productId: 'hdd', location: 'warehouse' as const, qty: 0 },
  ]

  it('counts free qty after other delivery reservations', () => {
    expect(freeQtyAtLocation({
      product,
      productId: 'hdd',
      location: 'shop',
      serials: [],
      bulkStock,
      reservations: [
        { productId: 'hdd', location: 'shop', status: 'reserved', deliveryId: 'dn-other', qty: 1, fulfilledQty: 0 },
      ],
      excludeDeliveryId: 'dn-this',
    })).toBe(1)
  })

  it('falls back from warehouse to shop when preferred location is empty', () => {
    const resolved = resolveBulkDeliverySourceLocation({
      product,
      productId: 'hdd',
      qty: 1,
      preferred: 'warehouse',
      serials: [],
      bulkStock,
      reservations: [],
    })
    expect(resolved.location).toBe('shop')
    expect(resolved.available).toBe(2)
  })

  it('keeps preferred location when it has enough stock', () => {
    const resolved = resolveBulkDeliverySourceLocation({
      product,
      productId: 'hdd',
      qty: 1,
      preferred: 'shop',
      serials: [],
      bulkStock,
      reservations: [],
    })
    expect(resolved.location).toBe('shop')
  })

  it('formats stock breakdown for error toasts', () => {
    expect(formatStockByLocation(
      { warehouse: 0, shop: 2, repair_unit: 0 },
      { warehouse: 'Warehouse', shop: 'Shop', repair_unit: 'Repair' },
    )).toBe('Warehouse: 0, Shop: 2, Repair: 0')
  })
})
