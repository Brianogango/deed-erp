/**
 * Which selected units may be deleted from the system.
 *
 * Deleting a unit removes it from inventory, With Issues and refurbishment.
 * A unit that a sale, invoice, delivery, purchase receipt, POS sale, Kilimall
 * order, warranty or customer repair names is part of that history and is
 * refused with the reason; a sold unit is refused too (it is with a customer,
 * or — with no sale behind it — goes back through "Sold with no sale record").
 * For a received unit that is no longer there, the tool is a write-off.
 *
 * Pure: the server decides with this under the serials lock.
 */

type Row = Record<string, any>

export type SerialDeleteDocs = {
  saleOrders?: Row[]
  deliveries?: Row[]
  invoices?: Row[]
  receipts?: Row[]
  posOrders?: Row[]
  kilimallOrders?: Row[]
  kilimallDispatches?: Row[]
  warranties?: Row[]
  repairs?: Row[]
}

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase()
const live = (doc: Row) => !['cancelled', 'canceled', 'void', 'voided', 'deleted'].includes(norm(doc?.status))

/** id → why it cannot be deleted. Units not in the map may be deleted. */
export function serialDeleteBlockers(units: Row[], docs: SerialDeleteDocs): Map<string, string> {
  const byId = new Map<string, string>()
  const byNumber = new Map<string, string>()
  const markId = (id: unknown, why: string) => { if (id && !byId.has(String(id))) byId.set(String(id), why) }
  const markNo = (n: unknown, why: string) => { const k = norm(n); if (k && !byNumber.has(k)) byNumber.set(k, why) }
  const ref = (doc: Row, fallback: string) => String(doc?.ref || doc?.kilimallRef || doc?.id || fallback)

  for (const so of docs.saleOrders ?? []) {
    if (!live(so)) continue
    for (const line of so.lines ?? []) for (const id of line?.serialIds ?? []) markId(id, `On sale order ${ref(so, 'a sale order')}`)
  }
  for (const d of docs.deliveries ?? []) {
    if (!live(d)) continue
    for (const line of d.lines ?? []) for (const id of line?.serialIds ?? []) markId(id, `On delivery ${ref(d, 'a delivery')}`)
  }
  for (const inv of docs.invoices ?? []) {
    if (!live(inv)) continue
    for (const line of inv.lines ?? []) {
      markId(line?.serialNumberId, `On invoice ${ref(inv, 'an invoice')}`)
      markId(line?.serialId, `On invoice ${ref(inv, 'an invoice')}`)
      markNo(line?.serialNumber, `On invoice ${ref(inv, 'an invoice')}`)
    }
  }
  for (const r of docs.receipts ?? []) {
    if (!live(r)) continue
    for (const line of r.lines ?? []) for (const n of line?.serials ?? []) markNo(n, `Received on ${ref(r, 'a purchase receipt')} — write it off instead`)
  }
  for (const pos of docs.posOrders ?? []) {
    if (!live(pos)) continue
    for (const line of pos.lines ?? []) {
      markId(line?.serialId, `Sold on ${ref(pos, 'a POS sale')}`)
      markNo(line?.serialNumber, `Sold on ${ref(pos, 'a POS sale')}`)
    }
  }
  for (const k of [...(docs.kilimallOrders ?? []), ...(docs.kilimallDispatches ?? [])]) {
    if (!live(k)) continue
    markId(k.serialId, `On Kilimall order ${ref(k, '')}`.trim())
    markNo(k.serialNumber, `On Kilimall order ${ref(k, '')}`.trim())
  }
  for (const w of docs.warranties ?? []) {
    if (!live(w)) continue
    markId(w.serialId, 'Has a warranty')
    markNo(w.serialNumber, 'Has a warranty')
  }
  for (const rep of docs.repairs ?? []) {
    if (!live(rep)) continue
    markId(rep.serialId, `On repair ${ref(rep, '')}`.trim())
  }

  const out = new Map<string, string>()
  for (const u of units) {
    const id = String(u?.id ?? '')
    if (!id) continue
    if (norm(u.status) === 'sold') { out.set(id, 'Sold — return it, or use "Sold with no sale record"'); continue }
    const why = byId.get(id) ?? byNumber.get(norm(u.serial ?? u.serialNumber))
    if (why) out.set(id, why)
  }
  return out
}
