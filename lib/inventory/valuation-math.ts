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

/** Stable idempotency keys / journal refs for stock valuation events. */
export function stockValuationEventKey(kind: 'receipt' | 'delivery', reference: string, productId: string) {
  const ref = String(reference || '').trim() || 'noref'
  const pid = String(productId || '').trim() || 'noprod'
  return `VAL/${kind === 'receipt' ? 'RCV' : 'DEL'}/${ref}/${pid}`.slice(0, 120)
}

export function stockValuationJournalRef(kind: 'receipt' | 'delivery', reference: string, productId: string) {
  const ref = String(reference || '').trim() || 'noref'
  const pid = String(productId || '').trim() || 'noprod'
  return `JRN/STK/${kind === 'receipt' ? 'RCV' : 'DEL'}/${ref}/${pid}`.slice(0, 80)
}
