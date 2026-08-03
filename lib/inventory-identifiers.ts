export type TrackingMethod = 'NONE' | 'QUANTITY' | 'BATCH' | 'SERIAL'

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

export function inferTrackingMethod(input: {
  trackingMethod?: string | null
  category?: string | null
  requiresSerial?: boolean | null
  unit?: string | null
}): TrackingMethod {
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
