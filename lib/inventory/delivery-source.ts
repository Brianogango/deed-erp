/**
 * Delivery stock helpers — resolve where to pick bulk qty from, and free qty
 * after excluding other deliveries' reservations.
 */

import { calcStockByLocation, type BulkStockLevel, type SerialNumber, type StockProduct } from '@/lib/business-logic'
import type { LocationId } from '@/lib/store'

export const DELIVERY_PICK_LOCATIONS: LocationId[] = ['warehouse', 'shop', 'repair_unit']

export type StockReservationLike = {
  productId: string
  location: string
  status: string
  deliveryId?: string
  /** Sale order / quote id that owns this reservation */
  referenceId?: string
  qty: number
  fulfilledQty: number
}

/**
 * A reservation is already held for *this* delivery/document when:
 * - it is tagged with this delivery id, or
 * - it is an orphan SO/quote reservation (same referenceId, no deliveryId yet).
 *
 * Quote→SO conversion often leaves the latter; treating it as "elsewhere"
 * falsely blocks Prepare Delivery (stockQty − own reservation).
 */
export function isOwnDeliveryReservation(
  reservation: StockReservationLike,
  opts: { excludeDeliveryId?: string; excludeReferenceId?: string },
): boolean {
  if (opts.excludeDeliveryId && reservation.deliveryId === opts.excludeDeliveryId) {
    return true
  }
  if (
    opts.excludeReferenceId
    && reservation.referenceId === opts.excludeReferenceId
    && !reservation.deliveryId
  ) {
    return true
  }
  return false
}

export function freeQtyAtLocation(args: {
  product: StockProduct | undefined
  productId: string
  location: LocationId
  serials: SerialNumber[]
  bulkStock: BulkStockLevel[]
  reservations: StockReservationLike[]
  excludeDeliveryId?: string
  excludeReferenceId?: string
}): number {
  const stockAtLocation = calcStockByLocation(
    args.product,
    args.serials,
    args.bulkStock,
    args.productId,
  )[args.location] ?? 0
  const reservedElsewhere = args.reservations
    .filter(reservation =>
      reservation.productId === args.productId
      && reservation.location === args.location
      && reservation.status === 'reserved'
      && !isOwnDeliveryReservation(reservation, {
        excludeDeliveryId: args.excludeDeliveryId,
        excludeReferenceId: args.excludeReferenceId,
      }),
    )
    .reduce((sum, reservation) => sum + Math.max(0, reservation.qty - reservation.fulfilledQty), 0)
  return Math.max(0, stockAtLocation - reservedElsewhere)
}

/**
 * Prefer the DN's preferred location when it has enough free stock; otherwise
 * use the first pick location (warehouse → shop → repair) that can cover qty.
 */
export function resolveBulkDeliverySourceLocation(args: {
  product: StockProduct | undefined
  productId: string
  qty: number
  preferred?: LocationId | null
  serials: SerialNumber[]
  bulkStock: BulkStockLevel[]
  reservations: StockReservationLike[]
  excludeDeliveryId?: string
  excludeReferenceId?: string
}): { location: LocationId; available: number; byLocation: Record<LocationId, number> } {
  const byLocation = {} as Record<LocationId, number>
  for (const location of DELIVERY_PICK_LOCATIONS) {
    byLocation[location] = freeQtyAtLocation({ ...args, location })
  }

  const preferred = args.preferred && DELIVERY_PICK_LOCATIONS.includes(args.preferred)
    ? args.preferred
    : 'warehouse'

  if ((byLocation[preferred] ?? 0) >= args.qty) {
    return { location: preferred, available: byLocation[preferred], byLocation }
  }

  const fallback = DELIVERY_PICK_LOCATIONS.find(location => (byLocation[location] ?? 0) >= args.qty)
  if (fallback) {
    return { location: fallback, available: byLocation[fallback], byLocation }
  }

  // Not enough anywhere — keep preferred for the error message context
  return { location: preferred, available: byLocation[preferred] ?? 0, byLocation }
}

export function formatStockByLocation(
  byLocation: Partial<Record<LocationId, number>>,
  labels: Partial<Record<LocationId, string>>,
): string {
  return DELIVERY_PICK_LOCATIONS
    .map(location => `${labels[location] ?? location}: ${byLocation[location] ?? 0}`)
    .join(', ')
}
