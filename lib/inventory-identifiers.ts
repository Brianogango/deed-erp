export type TrackingMethod = 'NONE' | 'QUANTITY' | 'BATCH' | 'SERIAL'

/** Categories that must always be unit (SERIAL) tracked — never QUANTITY. */
export const SERIAL_ONLY_CATEGORIES = [
  'laptops',
  'desktops',
  'printers',
  'networking',
  'mobile devices',
] as const

const CATEGORY_TRACKING_DEFAULT: Record<string, TrackingMethod> = {
  laptops: 'SERIAL',
  desktops: 'SERIAL',
  printers: 'SERIAL',
  networking: 'SERIAL',
  'mobile devices': 'SERIAL',
  accessories: 'QUANTITY',
  'parts & components': 'QUANTITY',
  services: 'NONE',
  'software & licences': 'NONE',
}

function normalizeSeed(value: string | null | undefined, fallback: string) {
  const cleaned = String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12)
  return cleaned || fallback
}

export function categoryDefaultTracking(category?: string | null): TrackingMethod | null {
  const categoryKey = String(category ?? '').trim().toLowerCase()
  return CATEGORY_TRACKING_DEFAULT[categoryKey] ?? null
}

export function isSerialOnlyCategory(category?: string | null): boolean {
  const categoryKey = String(category ?? '').trim().toLowerCase()
  return (SERIAL_ONLY_CATEGORIES as readonly string[]).includes(categoryKey)
}

/** Force SERIAL for machine categories; otherwise return the requested method. */
export function coerceTrackingForCategory(
  category: string | null | undefined,
  tracking: TrackingMethod,
): TrackingMethod {
  if (isSerialOnlyCategory(category)) return 'SERIAL'
  return tracking
}

export function inferTrackingMethod(input: {
  trackingMethod?: string | null
  category?: string | null
  requiresSerial?: boolean | null
  unit?: string | null
}): TrackingMethod {
  // Machine categories are always unit-tracked — never QUANTITY/BATCH.
  if (isSerialOnlyCategory(input.category)) return 'SERIAL'

  const explicit = String(input.trackingMethod ?? '').toUpperCase()
  if (explicit === 'NONE' || explicit === 'QUANTITY' || explicit === 'BATCH' || explicit === 'SERIAL') {
    return explicit
  }

  const fromCategory = categoryDefaultTracking(input.category)
  if (fromCategory) return fromCategory

  if (input.requiresSerial) return 'SERIAL'
  if (String(input.unit ?? '').toLowerCase() === 'service') return 'NONE'
  return 'QUANTITY'
}

export function isSerialTracking(method: TrackingMethod) {
  return method === 'SERIAL'
}

export function isStockTracked(method: TrackingMethod) {
  return method !== 'NONE'
}

/**
 * Whether Product Master should offer the Serials / on-hand intake drawer.
 * Machine categories (Laptops, Desktops, …) stay eligible even when the SKU was
 * wrongly saved as QUANTITY — intake will switch tracking to SERIAL.
 */
export function productOffersOnHandSerials(product: {
  trackingMethod?: string | null
  category?: string | null
  requiresSerial?: boolean | null
  unit?: string | null
}, opts?: { hasExistingSerials?: boolean }): boolean {
  if (String(product.unit ?? '').toLowerCase() === 'service') return false
  if (opts?.hasExistingSerials) return true
  const tracking = inferTrackingMethod(product)
  if (isSerialTracking(tracking)) return true
  if (product.requiresSerial) return true
  return categoryDefaultTracking(product.category) === 'SERIAL'
}

export function buildInventoryBarcode(params: {
  existingBarcodes: Iterable<string | null | undefined>
  manufacturerSerial?: string | null
  productSku?: string | null
}): string {
  const existing = new Set(
    Array.from(params.existingBarcodes, value => String(value ?? '').trim().toUpperCase()).filter(Boolean),
  )
  const seed = normalizeSeed(params.manufacturerSerial, normalizeSeed(params.productSku, 'ITEM'))

  let counter = 1
  while (true) {
    const candidate = `INV-${seed}-${String(counter).padStart(4, '0')}`
    if (!existing.has(candidate)) return candidate
    counter += 1
  }
}
