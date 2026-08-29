/** Pure weighted-average helpers — unit-testable, no DB. */

export function round4(n: number) {
  return Math.round(Number(n || 0) * 10000) / 10000
}

export function round2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100
}

export function applyReceiptAverage(params: {
  currentQty: number
  currentValue: number
  qty: number
  unitCost: number
}) {
  const qty = Math.max(0, Math.floor(Number(params.qty) || 0))
  const unitCost = Math.max(0, Number(params.unitCost) || 0)
  const currentQty = Math.max(0, Math.floor(Number(params.currentQty) || 0))
  const currentValue = Math.max(0, Number(params.currentValue) || 0)
  const newQty = currentQty + qty
  const newValue = round2(currentValue + qty * unitCost)
  const averageCost = newQty > 0 ? round4(newValue / newQty) : 0
  return { qty, unitCost, averageCost, totalQty: newQty, totalValue: newValue, totalCost: round2(qty * unitCost) }
}

export function applyDeliveryAverage(params: {
  currentQty: number
  currentValue: number
  averageCost: number
  qty: number
}) {
  const qty = Math.max(0, Math.floor(Number(params.qty) || 0))
  const avgCost = Math.max(0, Number(params.averageCost) || 0)
  const totalCost = round2(qty * avgCost)
  const currentQty = Math.max(0, Math.floor(Number(params.currentQty) || 0))
  const currentValue = Math.max(0, Number(params.currentValue) || 0)
  const newQty = Math.max(0, currentQty - qty)
  const newValue = Math.max(0, round2(currentValue - totalCost))
  const averageCost = newQty > 0 ? round4(newValue / newQty) : 0
  return { qty, unitCostUsed: avgCost, totalCost, averageCost, totalQty: newQty, totalValue: newValue }
}

export type StockValuationKind =
  | 'receipt'
  | 'delivery'
  | 'customer_return'
  | 'vendor_return'
  | 'adjustment_add'
  | 'adjustment_sub'
  | 'opening'
  | 'pos'
  | 'repair'

const KIND_TOKEN: Record<StockValuationKind, string> = {
  receipt: 'RCV',
  delivery: 'DEL',
  customer_return: 'CRTN',
  vendor_return: 'VRTN',
  adjustment_add: 'ADJ+',
  adjustment_sub: 'ADJ-',
  opening: 'OPEN',
  pos: 'POS',
  repair: 'RPR',
}

/** Stable idempotency keys / journal refs for stock valuation events. */
export function stockValuationEventKey(kind: StockValuationKind, reference: string, productId: string) {
  const ref = String(reference || '').trim() || 'noref'
  const pid = String(productId || '').trim() || 'noprod'
  return `VAL/${KIND_TOKEN[kind]}/${ref}/${pid}`.slice(0, 120)
}

export function stockValuationJournalRef(kind: StockValuationKind, reference: string, productId: string) {
  const ref = String(reference || '').trim() || 'noref'
  const pid = String(productId || '').trim() || 'noprod'
  return `JRN/STK/${KIND_TOKEN[kind]}/${ref}/${pid}`.slice(0, 80)
}

export type FifoBatchLayer = {
  id: string
  quantityAvailable: number
  unitCost: number
  receivedAt?: string | Date | null
}

export type FifoConsumptionLine = {
  batchId: string
  qty: number
  unitCost: number
  totalCost: number
}

/** Pure FIFO consumption — oldest batch layers first (by receivedAt, then id). */
export function consumeBatchesFIFO(
  batches: FifoBatchLayer[],
  qty: number,
): {
  consumed: FifoConsumptionLine[]
  remainingBatches: FifoBatchLayer[]
  totalCost: number
  shortfall: number
} {
  const need = Math.max(0, Math.floor(Number(qty) || 0))
  if (need <= 0) {
    return { consumed: [], remainingBatches: [...batches], totalCost: 0, shortfall: 0 }
  }

  const sorted = [...batches].sort((a, b) => {
    const ta = a.receivedAt ? new Date(a.receivedAt).getTime() : 0
    const tb = b.receivedAt ? new Date(b.receivedAt).getTime() : 0
    if (ta !== tb) return ta - tb
    return String(a.id).localeCompare(String(b.id))
  })

  let remaining = need
  const consumed: FifoConsumptionLine[] = []
  const remainingBatches: FifoBatchLayer[] = []

  for (const batch of sorted) {
    const available = Math.max(0, Math.floor(Number(batch.quantityAvailable) || 0))
    const unitCost = Math.max(0, Number(batch.unitCost) || 0)
    if (remaining <= 0) {
      if (available > 0) remainingBatches.push({ ...batch, quantityAvailable: available, unitCost })
      continue
    }
    if (available <= 0) continue
    const take = Math.min(available, remaining)
    if (take > 0) {
      consumed.push({
        batchId: batch.id,
        qty: take,
        unitCost,
        totalCost: round2(take * unitCost),
      })
      remaining -= take
      const left = available - take
      if (left > 0) remainingBatches.push({ ...batch, quantityAvailable: left, unitCost })
    }
  }

  const totalCost = round2(consumed.reduce((s, c) => s + c.totalCost, 0))
  return { consumed, remainingBatches, totalCost, shortfall: remaining }
}

export type FifoRestoreLayer = FifoBatchLayer & { quantityReceived: number }

/** Put consumed FIFO qty back onto the newest layers that still have room. */
export function restoreBatchesFIFO(
  batches: FifoRestoreLayer[],
  qty: number,
): {
  restored: Array<{ batchId: string; qty: number }>
  leftover: number
  remainingBatches: FifoRestoreLayer[]
} {
  const need = Math.max(0, Math.floor(Number(qty) || 0))
  const sorted = [...batches].sort((a, b) => {
    const ta = a.receivedAt ? new Date(a.receivedAt).getTime() : 0
    const tb = b.receivedAt ? new Date(b.receivedAt).getTime() : 0
    if (ta !== tb) return tb - ta
    return String(b.id).localeCompare(String(a.id))
  })

  let remaining = need
  const restored: Array<{ batchId: string; qty: number }> = []
  const remainingBatches: FifoRestoreLayer[] = []

  for (const batch of sorted) {
    const available = Math.max(0, Math.floor(Number(batch.quantityAvailable) || 0))
    const received = Math.max(0, Math.floor(Number(batch.quantityReceived) || 0))
    const room = Math.max(0, received - available)
    const unitCost = Math.max(0, Number(batch.unitCost) || 0)
    let nextAvail = available
    if (remaining > 0 && room > 0) {
      const take = Math.min(room, remaining)
      nextAvail = available + take
      remaining -= take
      restored.push({ batchId: batch.id, qty: take })
    }
    remainingBatches.push({ ...batch, quantityAvailable: nextAvail, unitCost })
  }

  return { restored, leftover: remaining, remainingBatches }
}

