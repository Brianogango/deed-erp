/**
 * Deliver a sale order's held units in one step (e.g. D.Light's 845 G7s,
 * invoiced long ago, sitting as "Held" because the delivery was never done).
 *
 * Plans, per order line, which held serials go out: units with status
 * `assigned` (held), at a Ready-for-Sale location, either held for this order
 * or for no order — never units held for another customer's order — up to
 * the quantity still to deliver. Pure; the route applies it through the
 * normal delivery stock path.
 */
import { deliveredByProductFromDoneDeliveries } from '@/lib/odoo-sales-flow'
import { isSalePickLocation } from '@/lib/inventory/sellable-stock'

type Row = Record<string, any>

export type HeldDeliveryLine = {
  productId: string
  productName: string
  ordered: number
  delivered: number
  remaining: number
  pick: Array<{ id: string; serial: string; productId: string }>
  heldForOtherOrders: Array<{ serial: string; orderRef: string }>
  heldElsewhere: Array<{ serial: string; why: string }>
}

const norm = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

export function planHeldDelivery(input: {
  saleOrder: Row
  serials: Row[]
  deliveries: Row[]
  saleOrders: Row[]
}): HeldDeliveryLine[] {
  const so = input.saleOrder
  const delivered = deliveredByProductFromDoneDeliveries(input.deliveries as never, String(so.id))
  const refById = new Map(input.saleOrders.map(o => [String(o.id), String(o.ref || o.orderNumber || o.id)]))
  const ordered = new Map<string, { productId: string; productName: string; qty: number }>()
  for (const line of (so.lines ?? []) as Row[]) {
    const productId = String(line.productId ?? '')
    if (!productId || line.lineType === 'section') continue
    const prev = ordered.get(productId)
    ordered.set(productId, { productId, productName: String(line.productName || prev?.productName || ''), qty: (prev?.qty ?? 0) + (Number(line.qty) || 0) })
  }
  const taken = new Set<string>()
  const out: HeldDeliveryLine[] = []
  for (const line of ordered.values()) {
    const done = delivered[line.productId] ?? 0
    const remaining = Math.max(0, line.qty - done)
    const sameProduct = (s: Row) => s.productId === line.productId || (norm(line.productName) && norm(s.productName) === norm(line.productName))
    const held = input.serials.filter(s => sameProduct(s) && ['assigned', 'refurbishment', 'under_repair'].includes(String(s.status)))
    const pick: HeldDeliveryLine['pick'] = []
    const heldForOtherOrders: HeldDeliveryLine['heldForOtherOrders'] = []
    const heldElsewhere: HeldDeliveryLine['heldElsewhere'] = []
    for (const s of [...held].sort((a, b) => String(a.serial).localeCompare(String(b.serial)))) {
      const serial = String(s.serial ?? s.id)
      const owner = s.saleOrderId ? String(s.saleOrderId) : ''
      if (owner && owner !== String(so.id)) {
        heldForOtherOrders.push({ serial, orderRef: refById.get(owner) ?? owner })
      } else if (s.status !== 'assigned') {
        heldElsewhere.push({ serial, why: s.status === 'refurbishment' ? 'in refurbishment' : 'under repair' })
      } else if (s.location && !isSalePickLocation(s.location)) {
        heldElsewhere.push({ serial, why: `in ${String(s.location).replace(/_/g, ' ')}, not Ready for Sale` })
      } else if (pick.length < remaining && !taken.has(String(s.id))) {
        taken.add(String(s.id))
        pick.push({ id: String(s.id), serial, productId: String(s.productId ?? line.productId) })
      }
    }
    out.push({ productId: line.productId, productName: line.productName, ordered: line.qty, delivered: done, remaining, pick, heldForOtherOrders, heldElsewhere })
  }
  return out
}
