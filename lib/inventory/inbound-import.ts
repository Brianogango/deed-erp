/**
 * Bring a supplier's delivery into Inbound from a file.
 *
 * Rows come from an Excel / CSV sheet (any reasonable headings) or from a
 * PDF / photo read by /api/inventory/inbound-import/extract. They are matched
 * to products, grouped per product, and checked: a serial-tracked product
 * needs one serial per unit, no serial twice, none already in the system.
 * The page then raises a purchase order for them and opens the goods
 * received note with the serials filled in and Inbound chosen, so the stock
 * enters through the normal receiving step (valuation, GRNI, serial intake).
 */

export type InboundSourceRow = {
  product: string
  sku?: string
  qty?: number | null
  unitCost?: number | null
  serials?: string[]
}

export type InboundProduct = {
  id: string
  name: string
  sku?: string
  requiresSerial?: boolean
  trackingMethod?: string
  costPrice?: number
  isActive?: boolean
}

export type InboundLine = {
  key: string
  productId: string | null
  productName: string
  sourceText: string
  qty: number
  unitCost: number
  serials: string[]
  requiresSerial: boolean
  issues: string[]
}

const norm = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
// "Unit Cost (KES)" → "unitcost": letters and digits only, currency suffix dropped.
const header = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(kes|kshs|ksh|usd)$/, '')

const COLUMNS: Record<keyof InboundSourceRow, string[]> = {
  product: ['product', 'productname', 'item', 'itemname', 'description', 'model', 'name', 'device'],
  sku: ['sku', 'code', 'itemcode', 'productcode', 'partnumber', 'partno', 'pn'],
  qty: ['qty', 'quantity', 'units', 'count', 'pcs'],
  unitCost: ['unitcost', 'cost', 'unitprice', 'price', 'buyingprice', 'costprice', 'rate'],
  serials: ['serial', 'serials', 'serialnumber', 'serialnumbers', 'serialno', 'sn', 'imei', 'servicetag'],
}

function pick(row: Record<string, unknown>, field: keyof InboundSourceRow): unknown {
  const names = COLUMNS[field]
  for (const [k, v] of Object.entries(row)) {
    if (names.includes(header(k)) && String(v ?? '').trim() !== '') return v
  }
  return undefined
}

const toNumber = (v: unknown): number | null => {
  if (v == null || String(v).trim() === '') return null
  const n = Number(String(v).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

export function splitSerials(v: unknown): string[] {
  return String(v ?? '')
    .split(/[;,\n\r\t|]+/)
    .map(s => s.trim().toUpperCase())
    .filter(s => s.length >= 3)
}

/** Sheet rows (first row as headings) → source rows. Blank rows are dropped. */
export function rowsFromSheet(rows: Array<Record<string, unknown>>): InboundSourceRow[] {
  const out: InboundSourceRow[] = []
  for (const row of rows) {
    const product = String(pick(row, 'product') ?? '').trim()
    const sku = String(pick(row, 'sku') ?? '').trim()
    const serials = splitSerials(pick(row, 'serials'))
    if (!product && !sku && !serials.length) continue
    out.push({ product, sku: sku || undefined, qty: toNumber(pick(row, 'qty')), unitCost: toNumber(pick(row, 'unitCost')), serials })
  }
  return out
}

export function matchProduct(row: { product: string; sku?: string }, products: InboundProduct[]): InboundProduct | null {
  const live = products.filter(p => p.isActive !== false)
  const sku = norm(row.sku)
  if (sku) {
    const bySku = live.find(p => norm(p.sku) === sku)
    if (bySku) return bySku
  }
  const name = norm(row.product)
  if (!name) return null
  return live.find(p => norm(p.name) === name)
    ?? live.find(p => norm(p.sku) === name)
    // "HP EliteBook 845 G7 - Ryzen 5 / 16GB" on an invoice vs "HP EliteBook 845 G7" in the catalogue
    ?? (() => {
      const hits = live.filter(p => norm(p.name).length >= 6 && name.startsWith(norm(p.name)))
      return hits.sort((a, b) => b.name.length - a.name.length)[0] ?? null
    })()
}

export const isSerialProduct = (p: InboundProduct | null | undefined) =>
  Boolean(p && (p.requiresSerial === true || String(p.trackingMethod ?? '').toUpperCase() === 'SERIAL'))

/** Match, group per product and check the rows. */
export function buildInboundLines(
  rows: InboundSourceRow[],
  products: InboundProduct[],
  existingSerials: Set<string>,
): InboundLine[] {
  const lines = new Map<string, InboundLine>()
  for (const row of rows) {
    const product = matchProduct(row, products)
    // Unmatched lines are keyed "?<sourceKey>" so a product pick can be applied to them.
    const key = product ? product.id : `?${sourceKey(row)}`
    const serials = row.serials ?? []
    const qty = row.qty != null && row.qty > 0 ? row.qty : serials.length || 1
    const line = lines.get(key) ?? {
      key,
      productId: product?.id ?? null,
      productName: product?.name ?? (row.product || row.sku || 'Unknown item'),
      sourceText: row.product || row.sku || '',
      qty: 0,
      unitCost: 0,
      serials: [],
      requiresSerial: isSerialProduct(product),
      issues: [],
    }
    line.qty += qty
    line.serials.push(...serials)
    if (row.unitCost != null && row.unitCost >= 0 && !line.unitCost) line.unitCost = row.unitCost
    lines.set(key, line)
  }

  const seen = new Map<string, string>()
  for (const line of lines.values()) {
    if (!line.unitCost) {
      const product = products.find(p => p.id === line.productId)
      if (product?.costPrice) line.unitCost = product.costPrice
    }
    if (!line.productId) line.issues.push(`"${line.sourceText}" is not in the product list — choose the product`)
    if (line.requiresSerial && line.serials.length !== line.qty) {
      line.issues.push(`${line.serials.length} serial number${line.serials.length === 1 ? '' : 's'} for ${line.qty} unit${line.qty === 1 ? '' : 's'}`)
    }
    const dupes = new Set<string>()
    const already: string[] = []
    for (const s of line.serials) {
      if (seen.has(s) || line.serials.indexOf(s) !== line.serials.lastIndexOf(s)) dupes.add(s)
      seen.set(s, line.key)
      if (existingSerials.has(s)) already.push(s)
    }
    if (dupes.size) line.issues.push(`Listed twice: ${[...dupes].slice(0, 3).join(', ')}${dupes.size > 3 ? '…' : ''}`)
    if (already.length) line.issues.push(`Already in the system: ${already.slice(0, 3).join(', ')}${already.length > 3 ? ` and ${already.length - 3} more` : ''}`)
  }
  return [...lines.values()]
}

/** The key a row is matched by, for "choose the product" picks. */
export const sourceKey = (row: { product: string; sku?: string }) => norm(row.product) || norm(row.sku)

/** Rows with the person's product picks applied (unmatched rows → chosen product). */
export function applyProductPicks(rows: InboundSourceRow[], picks: Record<string, string>, products: InboundProduct[]): InboundSourceRow[] {
  return rows.map(row => {
    const chosen = products.find(p => p.id === picks[sourceKey(row)])
    return chosen ? { ...row, product: chosen.name, sku: chosen.sku } : row
  })
}

export const INBOUND_TEMPLATE_HEADERS = ['Product', 'SKU', 'Serial Number', 'Qty', 'Unit Cost (KES)']
