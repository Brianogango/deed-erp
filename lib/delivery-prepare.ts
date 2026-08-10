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
  serialNumberId?: string | null
}

export type PrepareDeliveryLine = {
  productId: string
  productName: string
  qty: number
  serialIds?: string[] | null
  serialNumberId?: string | null
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

export type AssignedSerialRef = {
  id: string
  productId?: string
  saleOrderId?: string
  status?: string
}

export type DeliveryPrepareSerial = {
  id: string
  productId?: string
  saleOrderId?: string | null
  status?: string | null
}

/**
 * Serials listed on an SO / DN UI chip are often still `available` in inventory
 * (Prisma wrote sale_order_items.serial_number_id; deed_serials status lagged).
 * Prepare must claim those for this SO instead of failing "no longer reserved".
 */
export function isSerialHealableForDeliveryPrepare(
  serial: DeliveryPrepareSerial | null | undefined,
  opts: { saleOrderId: string; productId: string },
): boolean {
  if (!serial?.id) return false
  if (serial.productId && serial.productId !== opts.productId) return false
  const status = String(serial.status || '').toLowerCase()
  const linked = String(serial.saleOrderId || '')
  if (linked && linked !== opts.saleOrderId) return false
  if (status === 'sold' || status === 'delivered' || status === 'scrapped' || status === 'returned') {
    return false
  }
  // Already correctly reserved for this order — no heal needed.
  if ((status === 'assigned' || status === 'reserved') && linked === opts.saleOrderId) return false
  return status === 'available' || status === 'in_stock' || status === 'reserved' || status === 'assigned' || !status
}

export function assertSerialUsableForDeliveryPrepare(
  serial: DeliveryPrepareSerial | null | undefined,
  opts: { saleOrderId: string; productId: string; productName?: string },
): { ok: true; heal: boolean } | { ok: false; error: string } {
  const label = opts.productName || 'item'
  if (!serial?.id) {
    return { ok: false, error: `A selected serial for ${label} is missing from inventory` }
  }
  if (serial.productId && serial.productId !== opts.productId) {
    return { ok: false, error: `A selected serial for ${label} belongs to a different product` }
  }
  const status = String(serial.status || '').toLowerCase()
  const linked = String(serial.saleOrderId || '')
  if (linked && linked !== opts.saleOrderId) {
    return {
      ok: false,
      error: `A selected serial for ${label} is reserved for a different Sales Order`,
    }
  }
  if (status === 'sold' || status === 'delivered') {
    if (linked === opts.saleOrderId) return { ok: true, heal: false }
    return { ok: false, error: `A selected serial for ${label} is already sold` }
  }
  if ((status === 'assigned' || status === 'reserved') && linked === opts.saleOrderId) {
    return { ok: true, heal: false }
  }
  if (isSerialHealableForDeliveryPrepare(serial, opts)) {
    return { ok: true, heal: true }
  }
  return {
    ok: false,
    error: `A selected serial for ${label} is no longer reserved for this Sales Order`,
  }
}

/** Merge Prisma serialNumberId into client serialIds arrays for prepare pools. */
export function coalesceLineSerialIds(line: {
  serialIds?: string[] | null
  serialNumberId?: string | null
} | null | undefined): string[] {
  const fromArray = Array.isArray(line?.serialIds) ? line!.serialIds!.filter(Boolean) : []
  const single = line?.serialNumberId ? String(line.serialNumberId) : ''
  if (!single) return fromArray
  if (fromArray.includes(single)) return fromArray
  return [...fromArray, single]
}

/**
 * Build a FIFO serial pool per product from:
 * - SO line serialIds
 * - delivery line serialIds
 * - serial inventory rows already assigned to this sales order
 *
 * Prisma only stores one serialNumberId per SO line, so qty≥2 lines often
 * lose serialIds on refresh — assigned serial records + DN lines are the
 * durable source for prepare.
 */
export function buildSerialPoolsByProduct(
  soLines: PrepareSourceLine[] | null | undefined,
  deliveryLines: PrepareDeliveryLine[] | null | undefined = [],
  assignedSerials: AssignedSerialRef[] | null | undefined = [],
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
    for (const serialId of coalesceLineSerialIds(line)) push(line.productId, serialId)
  }
  for (const line of deliveryLines ?? []) {
    for (const serialId of coalesceLineSerialIds(line)) push(line.productId, serialId)
  }
  for (const serial of assignedSerials ?? []) {
    if (!serial.productId || !serial.id) continue
    const status = String(serial.status ?? '')
    if (status && !['assigned', 'reserved', 'sold'].includes(status)) continue
    push(serial.productId, serial.id)
  }
  return pools
}

/**
 * Plan qty + serials for each delivery line. Consumes requested qty and serial
 * pools so duplicate product rows do not all bind to the first SO line.
 * Prefers serials already stamped on the delivery line when present.
 */
export function planPrepareDeliveryLines(opts: {
  deliveryLines: PrepareDeliveryLine[]
  soLines: PrepareSourceLine[]
  requestedByProduct: Record<string, number>
  isSerialTracked: (productId: string) => boolean
  assignedSerials?: AssignedSerialRef[] | null
}): { ok: true; lines: PrepareLinePlan[] } | { ok: false; error: string; lines: PrepareLinePlan[] } {
  const { deliveryLines, soLines, isSerialTracked } = opts
  const requestedLeft = { ...opts.requestedByProduct }
  const pools = buildSerialPoolsByProduct(soLines, deliveryLines, opts.assignedSerials)
  const plans: PrepareLinePlan[] = []

  for (const deliveryLine of deliveryLines) {
    const serialTracked = isSerialTracked(deliveryLine.productId)
    const left = Math.max(0, Number(requestedLeft[deliveryLine.productId]) || 0)
    const pool = pools.get(deliveryLine.productId) ?? []
    const existingOnLine = coalesceLineSerialIds(deliveryLine)
    const requestedQty = left
    const qty = serialTracked
      ? Math.min(
          deliveryLine.qty,
          requestedQty > 0
            ? requestedQty
            : Math.max(pool.length, existingOnLine.length),
        )
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
      // Prefer serials already on this DN line (UI assign stamps them here).
      if (existingOnLine.length >= qty) {
        serialIds = existingOnLine.slice(0, qty)
        for (const id of serialIds) {
          const idx = pool.indexOf(id)
          if (idx >= 0) pool.splice(idx, 1)
        }
        pools.set(deliveryLine.productId, pool)
      } else if (pool.length < qty) {
        return {
          ok: false,
          error: `Assign ${qty} serial number${qty === 1 ? '' : 's'} for ${deliveryLine.productName} before preparing delivery`,
          lines: plans,
        }
      } else {
        serialIds = pool.splice(0, qty)
        pools.set(deliveryLine.productId, pool)
      }
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
  DL extends { productId?: string; qty?: number; qtyDone?: number; serialIds?: string[] | null },
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

/**
 * Allocate a per-product delivered-qty pool onto SO lines FIFO.
 *
 * Duplicate product rows must not each receive the full product total
 * (that overstates qtyDelivered and unlocks phantom invoiceable qty).
 *
 * - `add`: increment qtyDelivered by the allocated share of this shipment
 * - `max`: heal absolute delivered totals (set qtyDelivered = max(current, allocated))
 */
export function allocateDeliveredQtyToOrderLines<
  OL extends { productId?: string; qty?: number; qtyDelivered?: number; lineType?: string },
>(
  orderLines: OL[] | null | undefined,
  deliveredByProduct: Readonly<Record<string, number>>,
  mode: 'add' | 'max' = 'add',
): OL[] {
  const pool: Record<string, number> = {}
  for (const [productId, raw] of Object.entries(deliveredByProduct)) {
    pool[productId] = Math.max(0, Number(raw) || 0)
  }
  return (orderLines ?? []).map(line => {
    if (line.lineType === 'section' || !line.productId) return line
    const available = Math.max(0, Number(pool[line.productId]) || 0)
    if (available <= 0) return line
    const demand = Math.max(0, Number(line.qty) || 0)
    const current = Math.max(0, Number(line.qtyDelivered) || 0)
    if (mode === 'add') {
      const room = Math.max(0, demand - current)
      const take = Math.min(room, available)
      pool[line.productId] = available - take
      if (take <= 0) return line
      return { ...line, qtyDelivered: current + take }
    }
    // Absolute heal: consume the delivery total across lines; never exceed demand.
    const take = Math.min(demand, available)
    pool[line.productId] = available - take
    const next = Math.max(current, take)
    return next === current ? line : { ...line, qtyDelivered: next }
  })
}
