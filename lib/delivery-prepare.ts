/**
 * Helpers for Prepare Delivery when an SO has multiple lines for the same
 * productId (e.g. three ThinkPad rows). Serials live on each SO line; prepare
 * must consume them line-by-line instead of always using `.find(productId)`.
 */

export type PrepareSourceLine = {
  productId?: string
  lineType?: string
  qty?: number
  serialIds?: string[] | null
}

export type PrepareDeliveryLine = {
  productId: string
  productName: string
  qty: number
  serialIds?: string[] | null
}

export type PrepareLinePlan = {
  productId: string
  productName: string
  qty: number
  serialIds: string[]
  error?: string
}

/** Sum requested qty by productId (Object.fromEntries would keep only the last). */
export function sumQtyByProductId(
  lines: Array<{ productId?: string; qty?: number }> | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const line of lines ?? []) {
    if (!line.productId) continue
    out[line.productId] = (out[line.productId] ?? 0) + Math.max(0, Number(line.qty) || 0)
  }
  return out
}

/**
 * Build a FIFO serial pool per product from all SO lines (plus any serials
 * already stamped on the delivery line).
 */
export function buildSerialPoolsByProduct(
  soLines: PrepareSourceLine[] | null | undefined,
  deliveryLines: PrepareDeliveryLine[] | null | undefined = [],
): Map<string, string[]> {
  const pools = new Map<string, string[]>()
  const push = (productId: string, serialId: string) => {
    if (!productId || !serialId) return
    const list = pools.get(productId) ?? []
    if (!list.includes(serialId)) list.push(serialId)
    pools.set(productId, list)
  }
  for (const line of soLines ?? []) {
    if (!line.productId || line.lineType === 'section') continue
    for (const serialId of line.serialIds ?? []) push(line.productId, serialId)
  }
  for (const line of deliveryLines ?? []) {
    for (const serialId of line.serialIds ?? []) push(line.productId, serialId)
  }
  return pools
}

/**
 * Plan qty + serials for each delivery line. Consumes requested qty and serial
 * pools so duplicate product rows do not all bind to the first SO line.
 */
export function planPrepareDeliveryLines(opts: {
  deliveryLines: PrepareDeliveryLine[]
  soLines: PrepareSourceLine[]
  requestedByProduct: Record<string, number>
  isSerialTracked: (productId: string) => boolean
}): { ok: true; lines: PrepareLinePlan[] } | { ok: false; error: string; lines: PrepareLinePlan[] } {
  const { deliveryLines, soLines, isSerialTracked } = opts
  const requestedLeft = { ...opts.requestedByProduct }
  const pools = buildSerialPoolsByProduct(soLines, deliveryLines)
  const plans: PrepareLinePlan[] = []

  for (const deliveryLine of deliveryLines) {
    const serialTracked = isSerialTracked(deliveryLine.productId)
    const left = Math.max(0, Number(requestedLeft[deliveryLine.productId]) || 0)
    const pool = pools.get(deliveryLine.productId) ?? []
    const requestedQty = left
    const qty = serialTracked
      ? Math.min(deliveryLine.qty, requestedQty > 0 ? requestedQty : pool.length)
      : Math.min(deliveryLine.qty, requestedQty)
    requestedLeft[deliveryLine.productId] = Math.max(0, left - qty)

    let serialIds: string[] = []
    if (serialTracked && qty > 0) {
      if (qty < deliveryLine.qty) {
        return {
          ok: false,
          error: `${deliveryLine.productName} is serial-tracked — prepare all ${deliveryLine.qty} units together`,
          lines: plans,
        }
      }
      if (pool.length < qty) {
        return {
          ok: false,
          error: `Assign ${qty} serial number${qty === 1 ? '' : 's'} for ${deliveryLine.productName} before preparing delivery`,
          lines: plans,
        }
      }
      serialIds = pool.splice(0, qty)
      pools.set(deliveryLine.productId, pool)
    }

    plans.push({
      productId: deliveryLine.productId,
      productName: deliveryLine.productName,
      qty,
      serialIds,
    })
  }

  return { ok: true, lines: plans }
}

/**
 * Pair each order line to a unique delivery line for the same product.
 * Prefers matching qty so duplicate ThinkPad rows (1, 2, 1) do not all bind
 * to the first DN line via `.find(productId)`.
 */
export function pairOrderLinesWithDeliveryLines<
  OL extends { productId?: string; qty?: number; lineType?: string },
  DL extends { productId?: string; qty?: number },
>(
  orderLines: OL[] | null | undefined,
  deliveryLines: DL[] | null | undefined,
): Array<{ orderLine: OL; deliveryLine: DL | undefined }> {
  const queues = new Map<string, DL[]>()
  for (const d of deliveryLines ?? []) {
    if (!d.productId) continue
    const list = queues.get(d.productId) ?? []
    list.push(d)
    queues.set(d.productId, list)
  }

  const pairs: Array<{ orderLine: OL; deliveryLine: DL | undefined }> = []
  for (const orderLine of orderLines ?? []) {
    if (orderLine.lineType === 'section') continue
    if (!orderLine.productId) {
      pairs.push({ orderLine, deliveryLine: undefined })
      continue
    }
    const q = queues.get(orderLine.productId) ?? []
    let idx = q.findIndex(d => Number(d.qty) === Number(orderLine.qty))
    if (idx < 0) idx = q.length ? 0 : -1
    const deliveryLine = idx >= 0 ? q.splice(idx, 1)[0] : undefined
    pairs.push({ orderLine, deliveryLine })
  }
  return pairs
}
