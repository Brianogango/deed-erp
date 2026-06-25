export type TrackingMethod = 'NONE' | 'QUANTITY' | 'BATCH' | 'SERIAL'

const CATEGORY_TRACKING_DEFAULT: Record<string, TrackingMethod> = {
  laptops: 'SERIAL',
  desktops: 'SERIAL',
  printers: 'SERIAL',
  networking: 'SERIAL',
  accessories: 'QUANTITY',
  'parts & components': 'QUANTITY',
  services: 'NONE',
}

function normalizeSeed(value: string | null | undefined, fallback: string) {
  const cleaned = String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12)
  return cleaned || fallback
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

  const categoryKey = String(input.category ?? '').trim().toLowerCase()
  if (CATEGORY_TRACKING_DEFAULT[categoryKey]) {
    return CATEGORY_TRACKING_DEFAULT[categoryKey]
  }

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
