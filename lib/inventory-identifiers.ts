export type TrackingMethod = 'NONE' | 'QUANTITY' | 'BATCH' | 'SERIAL'

/** Categories that must always be unit (SERIAL) tracked — never QUANTITY. */
export const SERIAL_ONLY_CATEGORIES = [
  'laptops',
  'desktops',
  'complete desktops',
  'monitors',
  'servers',
  'power backup solutions',
  'printers',
  'networking',
  'mobile devices',
  'consumer electronics',
] as const

const CATEGORY_TRACKING_DEFAULT: Record<string, TrackingMethod> = {
  laptops: 'SERIAL',
  desktops: 'SERIAL',
  'complete desktops': 'SERIAL',
  monitors: 'SERIAL',
  servers: 'SERIAL',
  'power backup solutions': 'SERIAL',
  printers: 'SERIAL',
  networking: 'SERIAL',
  'mobile devices': 'SERIAL',
  'consumer electronics': 'SERIAL',
  accessories: 'QUANTITY',
  'parts & components': 'QUANTITY',
  'printer consumables': 'QUANTITY',
  services: 'NONE',
  'software & licences': 'NONE',
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

function normalizeTagSeed(value: string | null | undefined, fallback: string) {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
  return cleaned || fallback
}

/**
 * True when the stored tag should be rewritten to the manufacturer serial
 * (missing, INV-* legacy, or any value other than the serial).
 */
export function needsInventoryTagRewrite(row: {
  serial?: string | null
  barcode?: string | null
}): boolean {
  const serial = String(row.serial ?? '').trim()
  if (!serial) return false
  const barcode = String(row.barcode ?? '').trim()
  if (!barcode) return true
  return barcode.toUpperCase() !== serial.toUpperCase()
}

/**
 * Internal inventory barcode (Tag) — the manufacturer serial only.
 * No INV- prefix (that read as “invoice”). Falls back to SKU / ITEM when
 * serial is missing; appends -2, -3… on rare collisions.
 */
export function buildInventoryBarcode(params: {
  existingBarcodes: Iterable<string | null | undefined>
  manufacturerSerial?: string | null
  productSku?: string | null
}): string {
  const existing = new Set(
    Array.from(params.existingBarcodes, value => String(value ?? '').trim().toUpperCase()).filter(Boolean),
  )
  const seed = normalizeTagSeed(
    params.manufacturerSerial,
    normalizeTagSeed(params.productSku, 'ITEM'),
  )

  if (!existing.has(seed.toUpperCase())) return seed

  let counter = 2
  while (true) {
    const candidate = `${seed}-${counter}`
    if (!existing.has(candidate.toUpperCase())) return candidate
    counter += 1
  }
}

/**
 * Rewrite legacy INV-* (and other non-serial) tags to the manufacturer serial.
 * Rows without a serial are left unchanged.
 */
export function rewriteInventoryTags<T extends { serial?: string | null; barcode?: string | null }>(
  rows: T[],
): { rows: T[]; rewritten: number } {
  if (rows.length === 0) return { rows, rewritten: 0 }

  const used = new Set(
    rows
      .filter(row => !needsInventoryTagRewrite(row))
      .map(row => String(row.barcode ?? '').trim().toUpperCase())
      .filter(Boolean),
  )
  let rewritten = 0

  const allocate = (serial: string) => {
    if (!used.has(serial.toUpperCase())) {
      used.add(serial.toUpperCase())
      return serial
    }
    let counter = 2
    while (true) {
      const candidate = `${serial}-${counter}`
      if (!used.has(candidate.toUpperCase())) {
        used.add(candidate.toUpperCase())
        return candidate
      }
      counter += 1
    }
  }

  const nextRows = rows.map(row => {
    if (!needsInventoryTagRewrite(row)) return row
    const serial = String(row.serial ?? '').trim()
    rewritten += 1
    return { ...row, barcode: allocate(serial) }
  })

  return { rows: nextRows, rewritten }
}
