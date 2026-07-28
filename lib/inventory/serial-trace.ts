import type { LocationId } from '@/lib/store'

export type TraceableSerial = {
  id: string
  serial: string
  productId: string
  productName: string
  status: string
  location: LocationId | string
  saleOrderId?: string
  soldDate?: string
  repairId?: string
  purchaseOrderId?: string
  receiptId?: string
  receivedDate?: string
  barcode?: string
}

export type TraceableSaleOrder = {
  id: string
  ref?: string
  status: string
  customerName?: string
  lines: Array<{ serialIds?: string[]; productName?: string }>
}

export type TraceableStockMove = {
  id: string
  productId: string
  date: string
  reason: string
  documentRef: string
  serialNumbers?: string[]
  fromLocation?: string
  toLocation?: string
}

export type SerialTraceResult = {
  serial: TraceableSerial
  summary: string
  details: string[]
  linkedSaleOrder?: TraceableSaleOrder
  relatedMoves: TraceableStockMove[]
}

const LOCATION_LABELS: Record<string, string> = {
  warehouse: 'Warehouse',
  shop: 'Shop',
  repair_unit: 'Repair / Refurb unit',
  customer: 'Customer',
  vendor: 'Vendor',
  employee: 'Employee',
}

export function findSerialMatches(
  query: string,
  serials: TraceableSerial[],
): TraceableSerial[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return serials.filter(s =>
    s.serial.toLowerCase().includes(q) ||
    String(s.barcode || '').toLowerCase().includes(q) ||
    s.id.toLowerCase() === q,
  )
}

/** Human-readable “where did this serial go?” explanation. */
export function explainSerialWhereabouts(args: {
  serial: TraceableSerial
  saleOrders?: TraceableSaleOrder[]
  stockMoves?: TraceableStockMove[]
}): SerialTraceResult {
  const { serial, saleOrders = [], stockMoves = [] } = args
  const loc = LOCATION_LABELS[serial.location] || String(serial.location)
  const details: string[] = [
    `Product: ${serial.productName}`,
    `Status: ${serial.status.replace(/_/g, ' ')}`,
    `Location: ${loc}`,
  ]
  if (serial.receivedDate) details.push(`Received: ${serial.receivedDate.slice(0, 10)}`)
  if (serial.soldDate) details.push(`Sold date: ${serial.soldDate.slice(0, 10)}`)
  if (serial.purchaseOrderId) details.push(`Purchase / opening ref: ${serial.purchaseOrderId}`)
  if (serial.repairId) details.push(`Linked repair: ${serial.repairId}`)

  const linkedSaleOrder = saleOrders.find(so =>
    so.id === serial.saleOrderId ||
    so.lines.some(l => (l.serialIds || []).includes(serial.id)),
  )
  if (linkedSaleOrder) {
    details.push(
      `Sale order: ${linkedSaleOrder.ref || linkedSaleOrder.id} (${linkedSaleOrder.status})` +
      (linkedSaleOrder.customerName ? ` · ${linkedSaleOrder.customerName}` : ''),
    )
  }

  const relatedMoves = (stockMoves || [])
    .filter(m =>
      m.productId === serial.productId &&
      (m.serialNumbers || []).some(token => token.toLowerCase() === serial.serial.toLowerCase() || token === serial.id),
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8)

  relatedMoves.forEach(m => {
    details.push(`Move ${m.date.slice(0, 10)}: ${m.reason} (${m.documentRef})`)
  })

  let summary = ''
  switch (serial.status) {
    case 'available':
      summary = `On hand and free to sell at ${loc}.`
      break
    case 'assigned':
      summary = linkedSaleOrder
        ? `Reserved / picked on ${linkedSaleOrder.ref || 'a sales order'} — still in company stock but not Available.`
        : serial.repairId
          ? 'Held for a repair job — still in company stock but not Available.'
          : `Assigned / held at ${loc} — still on hand but not free to sell.`
      break
    case 'sold':
      summary = `Sold / with customer${serial.soldDate ? ` since ${serial.soldDate.slice(0, 10)}` : ''}${linkedSaleOrder ? ` via ${linkedSaleOrder.ref}` : ''}. Not in On hand or Available.`
      break
    case 'refurbishment':
      summary = `In refurbishment at ${loc} — counted in On hand, not Available.`
      break
    case 'under_repair':
      summary = `Under repair at ${loc} — counted in On hand, not Available.`
      break
    case 'returned':
      summary = `Returned to ${loc} after an RMA / customer return.`
      break
    case 'written_off':
      summary = 'Written off — removed from sellable stock.'
      break
    default:
      summary = `Current status “${serial.status}” at ${loc}.`
  }

  return { serial, summary, details, linkedSaleOrder, relatedMoves }
}
