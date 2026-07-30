/**
 * Odoo-style commercial product kinds for Deed ERP.
 * Distinct from Prisma `ProductType` (new/refurbished condition).
 */

import { inferTrackingMethod, isStockTracked, type TrackingMethod } from '@/lib/inventory-identifiers'

export type ProductKind = 'storable' | 'consumable' | 'service'

export const PRODUCT_KIND_OPTIONS: Array<{ value: ProductKind; label: string; hint: string }> = [
  { value: 'storable', label: 'Storable Product', hint: 'Tracked inventory with asset + COGS accounts' },
  { value: 'consumable', label: 'Consumable', hint: 'Bought/sold; qty optional; no inventory valuation required' },
  { value: 'service', label: 'Service', hint: 'Non-stock — labour, licences, fees' },
]

export const UOM_OPTIONS = [
  { value: 'pcs', label: 'Units (pcs)' },
  { value: 'unit', label: 'Unit' },
  { value: 'pair', label: 'Pair' },
  { value: 'box', label: 'Box' },
  { value: 'set', label: 'Set' },
  { value: 'hour', label: 'Hour' },
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'licence', label: 'Licence' },
  { value: 'service', label: 'Service' },
] as const

/** Default tracking when the user picks a product kind (can still override). */
export function defaultTrackingForKind(kind: ProductKind, category?: string | null): TrackingMethod {
  if (kind === 'service') return 'NONE'
  if (kind === 'consumable') return 'QUANTITY'
  return inferTrackingMethod({ category, trackingMethod: undefined })
}

/** Default UoM when kind or tracking changes. */
export function defaultUnitForKind(kind: ProductKind, tracking?: TrackingMethod): string {
  if (kind === 'service' || tracking === 'NONE') return 'service'
  return 'pcs'
}

export function inferProductKind(input: {
  productKind?: string | null
  trackingMethod?: string | null
  category?: string | null
  unit?: string | null
  requiresSerial?: boolean | null
}): ProductKind {
  const explicit = String(input.productKind ?? '').toLowerCase()
  if (explicit === 'storable' || explicit === 'consumable' || explicit === 'service') {
    return explicit
  }
  const tracking = inferTrackingMethod({
    trackingMethod: input.trackingMethod,
    category: input.category,
    requiresSerial: input.requiresSerial,
    unit: input.unit,
  })
  if (!isStockTracked(tracking) || String(input.unit ?? '').toLowerCase() === 'service') {
    return 'service'
  }
  const cat = String(input.category ?? '').toLowerCase()
  if (cat.includes('accessor') || cat.includes('part') || cat.includes('consum')) {
    return 'consumable'
  }
  if (cat === 'services' || cat.includes('software') || cat.includes('licence')) {
    return 'consumable'
  }
  return 'storable'
}

export function kindRequiresInventoryAccounts(kind: ProductKind): boolean {
  return kind === 'storable'
}

export function kindAllowsStockTracking(kind: ProductKind): boolean {
  return kind !== 'service'
}
