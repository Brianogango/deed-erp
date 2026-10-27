/**
 * Kilimall order returns: what changes on the order. The stock side (device
 * back to the warehouse, cost reversed) is done by the API route.
 */

export type KilimallReturnCondition = 'good' | 'damaged' | 'faulty'
export type KilimallReturnOutcome = 'refund' | 'exchange'

export type KilimallReturnInput = {
  condition: KilimallReturnCondition
  outcome: KilimallReturnOutcome
  reason: string
}

export type KilimallReturnEntry = {
  date: string
  by: string
  serialId?: string
  serialNumber?: string
  productId: string
  productName: string
  condition: KilimallReturnCondition
  outcome: KilimallReturnOutcome
  reason: string
  /** Kilimall had already paid this order in a settlement: expect a deduction. */
  paidInSettlementRef?: string
}

type Order = Record<string, any>

const CONDITIONS = new Set(['good', 'damaged', 'faulty'])
const OUTCOMES = new Set(['refund', 'exchange'])

export function kilimallReturnPlan(
  order: Order,
  input: Partial<KilimallReturnInput>,
  meta: { by: string; at: string },
):
  | { ok: true; order: Order; entry: KilimallReturnEntry; returnRef: string; productId: string; productName: string; serialId?: string }
  | { ok: false; error: string } {
  if (!['dispatched', 'delivered'].includes(String(order?.status))) {
    return { ok: false, error: 'Only a dispatched or delivered order can be returned.' }
  }
  const condition = String(input.condition ?? '') as KilimallReturnCondition
  const outcome = String(input.outcome ?? '') as KilimallReturnOutcome
  if (!CONDITIONS.has(condition)) return { ok: false, error: 'Choose the condition the device came back in.' }
  if (!OUTCOMES.has(outcome)) return { ok: false, error: 'Choose refund or exchange.' }
  const reason = String(input.reason ?? '').trim().slice(0, 500)
  if (!reason) return { ok: false, error: 'Say why the customer returned it.' }

  // The device that went out: a substitute when one was shipped.
  const productId = String(order.fulfilledProductId || order.productId || '')
  const productName = String(order.fulfilledProductName || order.productName || '')
  if (!productId) return { ok: false, error: 'This order has no product to take back.' }

  const history: KilimallReturnEntry[] = Array.isArray(order.returns) ? order.returns : []
  const entry: KilimallReturnEntry = {
    date: meta.at,
    by: meta.by,
    ...(order.serialId ? { serialId: String(order.serialId) } : {}),
    ...(order.serialNumber ? { serialNumber: String(order.serialNumber) } : {}),
    productId,
    productName,
    condition,
    outcome,
    reason,
    ...(order.settlementRef ? { paidInSettlementRef: String(order.settlementRef) } : {}),
  }
  const returnRef = `${order.ref} return ${history.length + 1}`

  const next: Order = { ...order, returns: [...history, entry] }
  if (outcome === 'refund') {
    next.status = 'returned'
  } else {
    // Ship a replacement through Dispatch: the order is pending again and
    // no longer points at the device that came back.
    next.status = 'pending'
    for (const k of ['serialId', 'serialNumber', 'dispatchId', 'fulfilledProductId', 'fulfilledProductName', 'substitutionReason']) delete next[k]
  }
  return { ok: true, order: next, entry, returnRef, productId, productName, serialId: order.serialId ? String(order.serialId) : undefined }
}
