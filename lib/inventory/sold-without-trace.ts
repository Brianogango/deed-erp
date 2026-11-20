/**
 * Units marked sold with no sale behind them.
 *
 * A serial's status said "sold", but no sale order, delivery, invoice, POS
 * sale, Kilimall order or warranty names it, and no stock movement for it
 * points at a sale document that exists. Such a unit was never sold (a
 * status set by mistake, a sale deleted afterwards, an import) and is still
 * on the shelf, so it can go back into stock.
 *
 * Anything that does name the unit counts as a trace, even a cancelled
 * document's neighbour: when in doubt the unit is left alone and must come
 * back through a return (After-Sales), which keeps the books right.
 *
 * Pure: the server re-checks with this before changing anything.
 */

type Row = Record<string, any>

export type SoldWithoutTraceInput = {
  serials: Row[]
  saleOrders?: Row[]
  deliveries?: Row[]
  invoices?: Row[]
  posOrders?: Row[]
  kilimallOrders?: Row[]
  kilimallDispatches?: Row[]
  warranties?: Row[]
  stockMoves?: Row[]
}

export type SoldWithoutTrace = {
  id: string
  serial: string
  productId: string
  productName: string
  location: string
  soldDate: string | null
  /** The last stock movement naming the unit, if any (its document no longer exists). */
  lastMove: { reason: string; documentRef: string; date: string } | null
}

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase()
const live = (doc: Row) => !['cancelled', 'canceled', 'void', 'voided', 'deleted'].includes(norm(doc?.status))

export function findSoldWithoutTrace(input: SoldWithoutTraceInput): SoldWithoutTrace[] {
  const sold = (input.serials ?? []).filter(s => norm(s?.status) === 'sold')
  if (!sold.length) return []

  // Every unit id and serial number any live sale document names.
  const ids = new Set<string>()
  const numbers = new Set<string>()
  const docRefs = new Set<string>()
  const docIds = new Set<string>()
  const addDoc = (doc: Row) => {
    if (doc?.id) docIds.add(String(doc.id))
    if (doc?.ref) docRefs.add(norm(doc.ref))
  }

  for (const so of input.saleOrders ?? []) {
    if (!live(so)) continue
    addDoc(so)
    for (const line of so.lines ?? []) for (const id of line?.serialIds ?? []) ids.add(String(id))
  }
  for (const d of input.deliveries ?? []) {
    if (!live(d)) continue
    addDoc(d)
    for (const line of d.lines ?? []) for (const id of line?.serialIds ?? []) ids.add(String(id))
  }
  for (const inv of input.invoices ?? []) {
    if (!live(inv)) continue
    addDoc(inv)
    for (const line of inv.lines ?? []) {
      if (line?.serialNumberId) ids.add(String(line.serialNumberId))
      if (line?.serialId) ids.add(String(line.serialId))
      if (line?.serialNumber) numbers.add(norm(line.serialNumber))
      for (const n of line?.serialNumbers ?? []) numbers.add(norm(n))
    }
  }
  for (const pos of input.posOrders ?? []) {
    if (!live(pos)) continue
    addDoc(pos)
    for (const line of pos.lines ?? []) {
      if (line?.serialId) ids.add(String(line.serialId))
      if (line?.serialNumber) numbers.add(norm(line.serialNumber))
    }
  }
  for (const k of [...(input.kilimallOrders ?? []), ...(input.kilimallDispatches ?? [])]) {
    if (!live(k)) continue
    addDoc(k)
    if (k.kilimallRef) docRefs.add(norm(k.kilimallRef))
    if (k.serialId) ids.add(String(k.serialId))
    if (k.serialNumber) numbers.add(norm(k.serialNumber))
  }
  for (const w of input.warranties ?? []) {
    if (!live(w)) continue
    if (w.serialId) ids.add(String(w.serialId))
    if (w.serialNumber) numbers.add(norm(w.serialNumber))
  }

  // Stock movements for each unit: one tied to a live sale document is a trace.
  const movesBySerial = new Map<string, Row[]>()
  for (const m of input.stockMoves ?? []) {
    if (m?.removedAt) continue
    for (const n of m?.serialNumbers ?? []) {
      const key = norm(n)
      if (!key) continue
      const list = movesBySerial.get(key)
      if (list) list.push(m)
      else movesBySerial.set(key, [m])
    }
  }

  const out: SoldWithoutTrace[] = []
  for (const s of sold) {
    const id = String(s.id ?? '')
    const number = norm(s.serial ?? s.serialNumber)
    if (ids.has(id) || (number && numbers.has(number))) continue
    if (s.saleOrderId && docIds.has(String(s.saleOrderId))) continue
    const moves = (number && movesBySerial.get(number)) || []
    if (moves.some(m => m.documentRef && docRefs.has(norm(m.documentRef)))) continue
    const last = [...moves].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))[0]
    out.push({
      id,
      serial: String(s.serial ?? s.serialNumber ?? id),
      productId: String(s.productId ?? ''),
      productName: String(s.productName ?? ''),
      location: String(s.location ?? ''),
      soldDate: s.soldDate ? String(s.soldDate) : null,
      lastMove: last ? { reason: String(last.reason ?? ''), documentRef: String(last.documentRef ?? ''), date: String(last.date ?? '') } : null,
    })
  }
  return out.sort((a, b) => a.productName.localeCompare(b.productName) || a.serial.localeCompare(b.serial))
}
