/**
 * Quantity stock as changes, not as a whole list.
 *
 * Every writer of quantity stock (receipts, deliveries, POS, transfers,
 * bench jobs, browser screens) used to load the whole list, change a few
 * rows and save the whole list back. Two writers at once, or a phone that
 * had not reloaded, each saved quantities from the moment they loaded, so
 * the later save wiped out the earlier one's change (REC/2026/0369: 16
 * received accessories vanished from the warehouse).
 *
 * A writer's change is the difference between the list it loaded (its base)
 * and the list it ended with. That difference is applied to the stored
 * quantities as "add N", so changes made meanwhile by anyone else stay.
 *
 * Pure — shared by the server store and /api/store.
 */

export type BulkStockRow = { productId?: unknown; location?: unknown; qty?: unknown }
export type BulkStockDelta = { productId: string; location: string; delta: number }

const keyOf = (row: BulkStockRow) =>
  `${String(row.productId ?? '')}|${String(row.location || 'warehouse')}`

function totals(rows: unknown): Map<string, number> {
  const out = new Map<string, number>()
  if (!Array.isArray(rows)) return out
  for (const raw of rows) {
    const row = raw as BulkStockRow
    if (!row || !row.productId) continue
    const key = keyOf(row)
    out.set(key, (out.get(key) ?? 0) + Math.round(Number(row.qty) || 0))
  }
  return out
}

/** What `next` changed relative to `base`, per product and location. */
export function diffBulkStock(base: unknown, next: unknown): BulkStockDelta[] {
  const before = totals(base)
  const after = totals(next)
  const out: BulkStockDelta[] = []
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const delta = (after.get(key) ?? 0) - (before.get(key) ?? 0)
    if (!delta) continue
    const cut = key.lastIndexOf('|')
    out.push({ productId: key.slice(0, cut), location: key.slice(cut + 1), delta })
  }
  return out
}

/**
 * The list with `deltas` added. Quantities never go below zero and rows that
 * reach zero drop out, as upsertBulkStock does.
 */
export function applyBulkStockDeltas(rows: unknown, deltas: BulkStockDelta[]): Array<{ productId: string; location: string; qty: number }> {
  const qty = totals(rows)
  for (const d of deltas) {
    const key = `${d.productId}|${d.location || 'warehouse'}`
    qty.set(key, Math.max(0, (qty.get(key) ?? 0) + d.delta))
  }
  const out: Array<{ productId: string; location: string; qty: number }> = []
  for (const [key, n] of qty) {
    if (n <= 0) continue
    const cut = key.lastIndexOf('|')
    out.push({ productId: key.slice(0, cut), location: key.slice(cut + 1), qty: n })
  }
  return out
}

export function isBulkStockDeltaList(value: unknown): value is BulkStockDelta[] {
  return Array.isArray(value) && value.every(d => {
    const v = d as BulkStockDelta
    return !!v && typeof v.productId === 'string' && v.productId.length > 0 && v.productId.length <= 80
      && typeof v.location === 'string' && v.location.length > 0 && v.location.length <= 40
      && Number.isInteger(v.delta) && Math.abs(v.delta) <= 1_000_000
  })
}
