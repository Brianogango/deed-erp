/**
 * Merge deed_saleOrders blob writes by id, preferring the fresher row.
 * Prevents a stale browser cache / slower soft broadcast from resurrecting
 * deleted quotation lines after a newer Save.
 */

type SaleOrderRow = {
  id?: unknown
  lockVersion?: unknown
  updatedAt?: unknown
  lines?: unknown
  items?: unknown
  [key: string]: unknown
}

function rowFreshness(row: SaleOrderRow): number {
  const lock = Number(row.lockVersion)
  if (Number.isFinite(lock)) return lock
  const ts = Date.parse(String(row.updatedAt ?? ''))
  return Number.isFinite(ts) ? ts : 0
}

function commercialLineCount(row: SaleOrderRow): number {
  const lines = Array.isArray(row.lines) ? row.lines : Array.isArray(row.items) ? row.items : []
  return lines.filter((l: any) => l && l.lineType !== 'section').length
}

/** Prefer newer lockVersion; on tie, prefer fewer commercial lines (deletes win over stale adds). */
export function pickFresherSaleOrderRow(current: SaleOrderRow, incoming: SaleOrderRow): SaleOrderRow {
  const a = rowFreshness(current)
  const b = rowFreshness(incoming)
  if (b > a) return incoming
  if (a > b) return current
  // Same freshness — keep the shorter commercial line set so a stale full
  // snapshot cannot undo a delete that shared the same lockVersion window.
  return commercialLineCount(incoming) < commercialLineCount(current) ? incoming : current
}

export function mergeSaleOrdersStoreWrite(current: unknown, incoming: unknown): SaleOrderRow[] {
  const currentArr: SaleOrderRow[] = Array.isArray(current) ? current : []
  const incomingArr: SaleOrderRow[] = Array.isArray(incoming) ? incoming : []
  if (incomingArr.length === 0) return currentArr

  const byId = new Map<string, SaleOrderRow>()
  for (const row of currentArr) {
    if (row && row.id != null) byId.set(String(row.id), row)
  }
  for (const row of incomingArr) {
    if (!row || row.id == null) continue
    const id = String(row.id)
    const prev = byId.get(id)
    byId.set(id, prev ? pickFresherSaleOrderRow(prev, row) : row)
  }
  // Preserve server-only rows the client omitted (partial caches).
  return [...byId.values()]
}
