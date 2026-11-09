/**
 * Excel rows for the machine intake (Add machines → Upload Excel): matched to
 * a model and checked before anything is saved. The server checks again.
 * Columns: Model, Serial, Asset ID, Issues, Cost. Only Model is needed; a
 * model not in the catalog is filed under the chosen "unidentified" product.
 *
 * Pure.
 */
import { classifySerialMatch } from '@/lib/refurbishment/unidentified'
import { isValidAssetId, normalizeAssetId } from '@/lib/inventory/asset-id'

export const INTAKE_SHEET_COLUMNS = ['Model', 'Serial', 'Asset ID', 'Issues', 'Cost'] as const

type ProductLike = { id: string; name: string; isActive?: boolean; requiresSerial?: boolean; trackingMethod?: string }
type SerialLike = { id?: string; serial?: string; status?: string; location?: string; assetId?: unknown; productName?: string }

export type IntakeSheetRow = {
  line: number
  model: string
  /** Matched catalog model; null → filed under the fallback product. */
  productId: string | null
  productName: string | null
  serial: string
  assetId: string
  issue: string
  cost: number | null
  problem: string | null
}

const cell = (row: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) {
    const hit = Object.keys(row).find(h => h.trim().toLowerCase() === k.toLowerCase())
    if (hit && row[hit] != null && String(row[hit]).trim()) return String(row[hit]).trim()
  }
  return ''
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function parseIntakeSheet(rows: Array<Record<string, unknown>>, products: ProductLike[], serials: SerialLike[]): IntakeSheetRow[] {
  const models = products.filter(p => p.isActive !== false && (p.requiresSerial || p.trackingMethod === 'SERIAL'))
  const byName = new Map(models.map(p => [norm(p.name), p]))
  const usedAssets = new Set(serials.map(s => normalizeAssetId(s.assetId)).filter(Boolean))
  const seenSerial = new Set<string>()
  const seenAsset = new Set<string>()
  const out: IntakeSheetRow[] = []
  rows.forEach((row, i) => {
    const model = cell(row, 'Model', 'Product', 'Device')
    const serial = cell(row, 'Serial', 'Serial number', 'S/N')
    const assetId = normalizeAssetId(cell(row, 'Asset ID', 'Asset', 'Sticker'))
    const issue = cell(row, 'Issues', 'Issue', 'Problem')
    const costText = cell(row, 'Cost', 'Price').replace(/[, ]/g, '')
    if (!model && !serial && !assetId && !issue && !costText) return // blank line
    // Exact name first, then a model whose name starts with what was typed.
    const key = norm(model)
    const match = (key && byName.get(key)) || (key ? models.find(p => norm(p.name).startsWith(key)) : undefined) || null
    let problem: string | null = null
    if (!model) problem = 'Model is missing'
    const cost = costText ? Number(costText) : null
    if (!problem && costText && !(Number.isFinite(cost) && (cost as number) >= 0)) problem = `Cost "${costText}" is not a number`
    if (!problem && serial) {
      if (serial.length < 3) problem = 'Serial is too short'
      else if (seenSerial.has(serial.toLowerCase())) problem = 'Serial is listed twice'
      else {
        const m = classifySerialMatch(serials, serial, '')
        if (m.kind === 'in_stock') problem = `Serial already in stock (${(m.match as SerialLike).productName ?? 'another product'})`
        if (m.kind === 'returning') problem = `We had this serial before (${m.match.status}) — use a return or trade-in`
      }
    }
    if (!problem && assetId) {
      if (!isValidAssetId(assetId)) problem = 'Asset ID should be letters then digits, e.g. LT000124'
      else if (seenAsset.has(assetId)) problem = 'Asset ID is listed twice'
      else if (usedAssets.has(assetId)) problem = 'Asset ID is already on another machine'
    }
    if (serial) seenSerial.add(serial.toLowerCase())
    if (assetId) seenAsset.add(assetId)
    out.push({
      line: i + 2, // row 1 is the header in Excel
      model,
      productId: match?.id ?? null,
      productName: match?.name ?? null,
      serial,
      assetId,
      issue,
      cost: costText && Number.isFinite(cost) ? cost : null,
      problem,
    })
  })
  return out
}
