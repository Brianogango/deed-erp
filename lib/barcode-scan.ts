/**
 * Shared barcode / QR scan parsing and matching for POS, transfers, GRN, ORC.
 *
 * Accepted payloads:
 * - Raw inventory barcode / manufacturer serial (tag === serial)
 * - Manufacturer serial
 * - Product SKU / product barcode
 * - Legacy serial-label QR: SKU:xxx|SERIAL:yyy
 * - Extended QR: SKU:xxx|SERIAL:yyy|BARCODE:zzz
 * - Legacy INV-* tags (still matched if present in stock)
 */

export type ParsedScan = {
  raw: string
  normalized: string
  sku?: string
  serial?: string
  barcode?: string
  /** Unique identity candidates to try against stock records (order = preference). */
  candidates: string[]
}

const PIPE_FIELD = /(?:^|\|)(SKU|SERIAL|BARCODE)\s*:\s*([^|]+)/gi

export function normalizeScanCode(raw: string | null | undefined): string {
  return String(raw ?? '').trim()
}

export function codesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeScanCode(a)
  const right = normalizeScanCode(b)
  if (!left || !right) return false
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0
}

function pushUnique(list: string[], value: string | undefined) {
  const v = normalizeScanCode(value)
  if (!v) return
  if (list.some(existing => codesEqual(existing, v))) return
  list.push(v)
}

/** Parse a scanned string into structured fields + lookup candidates. */
export function parseScanPayload(rawInput: string | null | undefined): ParsedScan {
  const raw = normalizeScanCode(rawInput)
  const normalized = raw
  if (!raw) {
    return { raw: '', normalized: '', candidates: [] }
  }

  let sku: string | undefined
  let serial: string | undefined
  let barcode: string | undefined

  const pipeMatches = [...raw.matchAll(PIPE_FIELD)]
  if (pipeMatches.length > 0) {
    for (const match of pipeMatches) {
      const key = match[1].toUpperCase()
      const value = normalizeScanCode(match[2])
      if (!value) continue
      if (key === 'SKU') sku = value
      else if (key === 'SERIAL') serial = value
      else if (key === 'BARCODE') barcode = value
    }
  } else if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const json = JSON.parse(raw) as Record<string, unknown>
      sku = normalizeScanCode(String(json.sku ?? json.SKU ?? '')) || undefined
      serial = normalizeScanCode(String(json.serial ?? json.SERIAL ?? json.serialNumber ?? '')) || undefined
      barcode = normalizeScanCode(String(json.barcode ?? json.BARCODE ?? json.inventoryBarcode ?? '')) || undefined
    } catch {
      // treat as plain text below
    }
  }

  const candidates: string[] = []
  // Prefer inventory barcode, then manufacturer serial, then bare payload, then SKU.
  pushUnique(candidates, barcode)
  pushUnique(candidates, serial)
  if (!barcode && !serial) pushUnique(candidates, normalized)
  else if (normalized && !codesEqual(normalized, barcode) && !codesEqual(normalized, serial) && !pipeMatches.length) {
    pushUnique(candidates, normalized)
  } else if (pipeMatches.length === 0 && !barcode && !serial) {
    // already pushed normalized
  } else if (pipeMatches.length > 0) {
    // structured payload — also try full raw only if it wasn't field-based
  }
  pushUnique(candidates, sku)

  // Plain CODE128 / QR of inventory barcode or serial (most common path)
  if (candidates.length === 0) pushUnique(candidates, normalized)

  return { raw, normalized, sku, serial, barcode, candidates }
}

export type ScanIdentity = {
  barcode?: string | null
  serial?: string | null
  sku?: string | null
}

/** True when any scan candidate matches barcode, manufacturer serial, or sku. */
export function identityMatchesScan(identity: ScanIdentity, scan: ParsedScan | string): boolean {
  const parsed = typeof scan === 'string' ? parseScanPayload(scan) : scan
  const fields = [identity.barcode, identity.serial, identity.sku]
  return parsed.candidates.some(candidate => fields.some(field => codesEqual(field, candidate)))
}

export type PosSerialCandidate = ScanIdentity & {
  id: string
  productId: string
  status: string
  location: string
}

export type PosProductCandidate = {
  id: string
  name: string
  sku?: string | null
  barcode?: string | null
  requiresSerial?: boolean
  unit?: string | null
}

export type PosScanMatch =
  | { kind: 'serial'; serial: PosSerialCandidate }
  | { kind: 'product'; product: PosProductCandidate; needsUnitScan: boolean }
  | { kind: 'out_of_stock'; product: PosProductCandidate }
  | { kind: 'not_found'; code: string }

/**
 * Resolve a POS scan against sellable serials then products.
 * Serial match wins so unit barcodes never land on the parent product.
 */
export function matchPosScan(input: {
  code: string
  serials: PosSerialCandidate[]
  products: PosProductCandidate[]
  sellableLocations?: Set<string> | string[]
  getSellableQty: (productId: string, requiresSerial: boolean) => number
}): PosScanMatch {
  const parsed = parseScanPayload(input.code)
  if (!parsed.candidates.length) return { kind: 'not_found', code: '' }

  const locations = input.sellableLocations instanceof Set
    ? input.sellableLocations
    : new Set(input.sellableLocations ?? ['warehouse', 'shop'])

  const matchedSerial = input.serials.find(s =>
    s.status === 'available'
    && locations.has(s.location)
    && identityMatchesScan(s, parsed),
  )
  if (matchedSerial) return { kind: 'serial', serial: matchedSerial }

  const product = input.products.find(p =>
    parsed.candidates.some(c => codesEqual(p.barcode, c) || codesEqual(p.sku, c)),
  )
  if (!product) return { kind: 'not_found', code: parsed.normalized || input.code }

  const requiresSerial = !!product.requiresSerial
  if (product.unit !== 'service' && input.getSellableQty(product.id, requiresSerial) <= 0) {
    return { kind: 'out_of_stock', product }
  }
  return { kind: 'product', product, needsUnitScan: requiresSerial }
}

/**
 * Resolve an ORC verification scan to the confirmed serial string that should
 * be stored (prefer the document's expected manufacturer serial when the scan
 * identifies the same physical unit via inventory barcode).
 */
export function resolveOrcConfirmedSerial(input: {
  scanned: string
  expectedSerial: string
  serials?: Array<ScanIdentity & { id?: string }>
}): { confirmed: string; matched: boolean } {
  const parsed = parseScanPayload(input.scanned)
  const expected = normalizeScanCode(input.expectedSerial)

  if (parsed.candidates.some(c => codesEqual(c, expected))) {
    return { confirmed: expected || parsed.normalized, matched: true }
  }

  const unit = (input.serials ?? []).find(s => identityMatchesScan(s, parsed))
  if (unit && codesEqual(unit.serial, expected)) {
    return { confirmed: expected, matched: true }
  }
  // Also accept when expected was stored as inventory barcode
  if (unit && (codesEqual(unit.barcode, expected) || codesEqual(unit.serial, expected))) {
    return { confirmed: normalizeScanCode(unit.serial) || expected, matched: true }
  }

  return {
    confirmed: parsed.serial || parsed.barcode || parsed.normalized,
    matched: false,
  }
}

/** Build the QR / CODE128 payload printed on a serial unit label.
 * Prefer manufacturer serial so shop-floor scans match the physical device. */
export function buildSerialLabelScanPayload(item: {
  serial: string
  barcode?: string | null
  sku?: string | null
}): string {
  const serial = normalizeScanCode(item.serial)
  if (serial) return serial
  return normalizeScanCode(item.barcode)
}

/** Human-readable secondary line for labels (does not replace the scan payload). */
export function buildSerialLabelLegacyHint(item: {
  serial: string
  barcode?: string | null
  sku?: string | null
}): string {
  const parts = [
    item.sku ? `SKU:${normalizeScanCode(item.sku)}` : '',
    `SERIAL:${normalizeScanCode(item.serial)}`,
    item.barcode ? `BARCODE:${normalizeScanCode(item.barcode)}` : '',
  ].filter(Boolean)
  return parts.join('|')
}
