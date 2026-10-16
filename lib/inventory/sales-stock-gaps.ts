/**
 * Read-only audit: sales that should have taken stock out but did not.
 * Three channels are checked against the serial register and the stock-move history:
 *   - Kilimall dispatches, till (POS) sales and validated delivery notes.
 * A serial that is not `sold` is reported with its current status; a serial that came
 * back through a customer return can legitimately be available again, so the report
 * says what it found and leaves the decision to a person.
 */

type Rec = Record<string, any>

export interface SalesStockGap {
  channel: 'kilimall' | 'pos' | 'delivery'
  documentRef: string
  date: string
  productName: string
  serialNumber?: string
  problem: 'serial_not_sold' | 'serial_missing' | 'no_stock_move'
  serialStatus?: string
  location?: string
}

export interface SalesStockGapReport {
  checked: { kilimallDispatches: number; posOrders: number; deliveries: number }
  gaps: SalesStockGap[]
}

export function findSalesStockGaps(input: {
  serials: Rec[]
  products?: Rec[]
  posOrders: Rec[]
  deliveries: Rec[]
  kilimallDispatches: Rec[]
  stockMoves: Rec[]
}): SalesStockGapReport {
  const serialById = new Map(input.serials.map(s => [String(s.id), s]))
  const productById = new Map((input.products ?? []).map(p => [String(p.id), p]))
  const moveRefs = new Set(input.stockMoves.map(m => String(m.documentRef || '')))
  const gaps: SalesStockGap[] = []

  const serialGap = (
    channel: SalesStockGap['channel'], documentRef: string, date: string, productName: string,
    serialId: string | undefined, serialNumber: string | undefined, productId: string | undefined,
  ) => {
    const serial = (serialId && serialById.get(serialId))
      || input.serials.find(s => productId && s.productId === productId && serialNumber
        && String(s.serial || '').toLowerCase() === serialNumber.toLowerCase())
    if (!serial) {
      gaps.push({ channel, documentRef, date, productName, serialNumber, problem: 'serial_missing' })
      return
    }
    if (String(serial.status || '').toLowerCase() === 'sold') return
    gaps.push({
      channel, documentRef, date, productName, serialNumber: String(serial.serial || serialNumber || ''),
      problem: 'serial_not_sold', serialStatus: String(serial.status || ''), location: String(serial.location || ''),
    })
  }

  const dispatches = input.kilimallDispatches.filter(d => d.status === 'dispatched')
  for (const d of dispatches) {
    serialGap('kilimall', String(d.orderRef || d.ref || ''), String(d.dispatchDate || d.date || ''), String(d.productName || ''), d.serialId, d.serialNumber, d.productId)
  }

  for (const o of input.posOrders) {
    for (const line of Array.isArray(o.lines) ? o.lines : []) {
      const product = productById.get(String(line.productId))
      if (line.serialId || line.serialNumber) {
        serialGap('pos', String(o.ref || ''), String(o.date || ''), String(line.productName || ''), line.serialId, line.serialNumber, line.productId)
      } else if (product && product.requiresSerial !== true && Number(line.qty) > 0 && !moveRefs.has(String(o.ref || ''))) {
        gaps.push({ channel: 'pos', documentRef: String(o.ref || ''), date: String(o.date || ''), productName: String(line.productName || ''), problem: 'no_stock_move' })
      }
    }
  }

  const done = input.deliveries.filter(d => d.status === 'done')
  for (const d of done) {
    for (const line of Array.isArray(d.lines) ? d.lines : []) {
      const ids: string[] = Array.isArray(line.serialIds) ? line.serialIds : []
      if (ids.length) {
        for (const id of ids) serialGap('delivery', String(d.ref || ''), String(d.date || ''), String(line.productName || ''), id, undefined, line.productId)
      } else if (Number(line.qtyDone ?? line.qty) > 0 && productById.get(String(line.productId))?.requiresSerial !== true && !moveRefs.has(String(d.ref || ''))) {
        gaps.push({ channel: 'delivery', documentRef: String(d.ref || ''), date: String(d.date || ''), productName: String(line.productName || ''), problem: 'no_stock_move' })
      }
    }
  }

  return { checked: { kilimallDispatches: dispatches.length, posOrders: input.posOrders.length, deliveries: done.length }, gaps }
}
