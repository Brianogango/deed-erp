import { describe, expect, it } from 'vitest'
import {
  formatStockByLocation,
  freeQtyAtLocation,
  isOwnDeliveryReservation,
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

  it('does not treat this delivery’s own reservation as elsewhere', () => {
    expect(freeQtyAtLocation({
      product,
      productId: 'hdd',
      location: 'shop',
      serials: [],
      bulkStock,
      reservations: [
        { productId: 'hdd', location: 'shop', status: 'reserved', deliveryId: 'dn-this', qty: 2, fulfilledQty: 0 },
      ],
      excludeDeliveryId: 'dn-this',
    })).toBe(2)
  })

  it('does not treat orphan SO/quote reservations as elsewhere (Moses self-reservation)', () => {
    // Stock 6 at warehouse, SO already reserved 4 with no deliveryId (quote-era).
    // Preparing DN for that SO must see free=6, not free=2.
    const warehouseStock = [
      { productId: 'stand', location: 'warehouse' as const, qty: 6 },
      { productId: 'stand', location: 'shop' as const, qty: 0 },
    ]
    expect(freeQtyAtLocation({
      product,
      productId: 'stand',
      location: 'warehouse',
      serials: [],
      bulkStock: warehouseStock,
      reservations: [
        {
          productId: 'stand',
          location: 'warehouse',
          status: 'reserved',
          referenceId: 'so-moses',
          qty: 4,
          fulfilledQty: 0,
        },
      ],
      excludeDeliveryId: 'dn-moses',
      excludeReferenceId: 'so-moses',
    })).toBe(6)
  })

  it('still counts another order’s orphan reservation as elsewhere', () => {
    const warehouseStock = [
      { productId: 'stand', location: 'warehouse' as const, qty: 6 },
    ]
    expect(freeQtyAtLocation({
      product,
      productId: 'stand',
      location: 'warehouse',
      serials: [],
      bulkStock: warehouseStock,
      reservations: [
        {
          productId: 'stand',
          location: 'warehouse',
          status: 'reserved',
          referenceId: 'so-other',
          qty: 4,
          fulfilledQty: 0,
        },
      ],
      excludeDeliveryId: 'dn-moses',
      excludeReferenceId: 'so-moses',
    })).toBe(2)
  })

  it('still counts another delivery’s reservation on the same SO as elsewhere', () => {
    // DN1 already prepared/reserved — DN2 must not steal that free qty.
    const warehouseStock = [
      { productId: 'stand', location: 'warehouse' as const, qty: 6 },
    ]
    expect(freeQtyAtLocation({
      product,
      productId: 'stand',
      location: 'warehouse',
      serials: [],
      bulkStock: warehouseStock,
      reservations: [
        {
          productId: 'stand',
          location: 'warehouse',
          status: 'reserved',
          referenceId: 'so-moses',
          deliveryId: 'dn-1',
          qty: 4,
          fulfilledQty: 0,
        },
      ],
      excludeDeliveryId: 'dn-2',
      excludeReferenceId: 'so-moses',
    })).toBe(2)
  })

  it('identifies own orphan and delivery-tagged reservations', () => {
    expect(isOwnDeliveryReservation(
      { productId: 'p', location: 'warehouse', status: 'reserved', referenceId: 'so-1', qty: 1, fulfilledQty: 0 },
      { excludeReferenceId: 'so-1' },
    )).toBe(true)
    expect(isOwnDeliveryReservation(
      { productId: 'p', location: 'warehouse', status: 'reserved', deliveryId: 'dn-1', qty: 1, fulfilledQty: 0 },
      { excludeDeliveryId: 'dn-1' },
    )).toBe(true)
    expect(isOwnDeliveryReservation(
      { productId: 'p', location: 'warehouse', status: 'reserved', referenceId: 'so-1', deliveryId: 'dn-1', qty: 1, fulfilledQty: 0 },
      { excludeDeliveryId: 'dn-2', excludeReferenceId: 'so-1' },
    )).toBe(false)
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
