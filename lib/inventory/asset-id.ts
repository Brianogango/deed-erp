/**
 * Machine asset IDs: the Deed sticker number, printed as the barcode, that a
 * machine keeps for life (With Issues → refurbishment → sale → warranty).
 * Two letters for the category and six digits, counted per category:
 * LT000124 (laptop), DK000031 (desktop), MN000012 (monitor)…
 *
 * DT is left out on purpose: laptops already carry DT000005… stickers from
 * before, and those numbers are kept as they are.
 *
 * Pure.
 */

const CATEGORY_PREFIX: Record<string, string> = {
  Laptops: 'LT',
  Desktops: 'DK',
  'Complete Desktops': 'DK',
  Monitors: 'MN',
  Servers: 'SV',
  Printers: 'PR',
  'Power Backup Solutions': 'PB',
  Networking: 'NW',
  'Mobile Devices': 'MB',
  'Consumer Electronics': 'CE',
  'Parts & Components': 'PT',
  Accessories: 'AC',
}

/** Prefix for a category; anything unknown counts as an accessory-like item. */
export function assetIdPrefix(category: string | null | undefined): string {
  const key = String(category ?? '').trim()
  if (CATEGORY_PREFIX[key]) return CATEGORY_PREFIX[key]
  // Unidentified placeholders ("Laptop — unidentified") file under their device's category.
  if (/laptop/i.test(key)) return 'LT'
  if (/desktop/i.test(key)) return 'DK'
  return 'AC'
}

export function formatAssetId(prefix: string, n: number): string {
  return `${prefix}${String(Math.max(0, Math.floor(n))).padStart(6, '0')}`
}

/** An asset ID as typed or scanned: trimmed, upper case, no spaces. */
export function normalizeAssetId(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '')
}

/** Sticker numbers we accept when typed in: letters then digits (LT000124, DT000005). */
export function isValidAssetId(value: unknown): boolean {
  return /^[A-Z]{1,4}\d{3,10}$/.test(normalizeAssetId(value))
}

/** Highest number already used with this prefix, from the machines' asset IDs. */
export function highestAssetNumber(prefix: string, assetIds: Iterable<unknown>): number {
  const re = new RegExp(`^${prefix}(\\d+)$`)
  let max = 0
  for (const id of assetIds) {
    const m = re.exec(normalizeAssetId(id))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max
}
