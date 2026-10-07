/**
 * The parts-request queue: what a technician asked for, and where the desk is
 * with it.
 *
 * A request exists because the part is not on the shelf. The order the shop
 * works in:
 *   1. Adjustment — when the system still shows the part in the warehouse, the
 *      count is wrong: correct it down with a stock adjustment, so nobody else
 *      sells or quotes a part that is not there.
 *   2. Purchase order — the part is not in stock, so it is bought. The order
 *      carries the repair, so receiving it on a GRN puts the repair back to
 *      work.
 *   3. Mark parts arrived — hands the repair back to the technician.
 *
 * Pure: no store, no fetch, so the rules can be tested on their own.
 */

export type PartsRequestStatus = 'pending' | 'ordered' | 'received' | 'cancelled'

export type PartsRequestItem = {
  type: string
  productId: string
  productName: string
  description: string
  qty: string
  estimatedCost: string
  supplier: string
}

export type PartsRequest = {
  id: string
  repairId?: string
  repairRef?: string
  requestedBy: string
  requestedByName: string
  requestedDate: string
  urgency: string
  status: PartsRequestStatus
  notes: string
  items: PartsRequestItem[]
  /** Count corrections raised because the system showed parts that were not there. */
  adjustmentRefs?: string[]
  /** Products whose count was corrected (or confirmed right) for this request. */
  countCheckedProductIds?: string[]
  purchaseOrderId?: string
  orderReference?: string
  orderedDate?: string
  receivedDate?: string
}

export type RepairForParts = {
  id: string
  ref: string
  status: string
  productName?: string
  customerName?: string
  procurementRequests?: PartsRequest[] | null
}

export type PartsStep = 'adjust_then_order' | 'awaiting_delivery' | 'mark_arrived'

export type PartsQueueRow = {
  repairId: string
  repairRef: string
  device: string
  customerName: string
  repairStatus: string
  request: PartsRequest
  step: PartsStep
  ageDays: number
}

const URGENCY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

const daysBetween = (from: string, to: string) => {
  const a = new Date(String(from).slice(0, 10)).getTime()
  const b = new Date(String(to).slice(0, 10)).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

/**
 * Where a request stands. A received request is finished, but the repair still
 * waits on the desk to mark the parts arrived — only then does the technician
 * see it back in the queue.
 */
export function partsStep(request: PartsRequest, repairStatus: string): PartsStep | null {
  if (request.status === 'cancelled') return null
  if (request.status === 'pending') return 'adjust_then_order'
  if (request.status === 'ordered') return 'awaiting_delivery'
  return repairStatus === 'awaiting_parts' ? 'mark_arrived' : null
}

/** Open requests across every repair: most urgent first, then the oldest. */
export function partsQueue(repairs: RepairForParts[], today: string): PartsQueueRow[] {
  const rows: PartsQueueRow[] = []
  for (const repair of repairs) {
    const requests = repair.procurementRequests ?? []
    // "Mark parts arrived" closes every request on the repair at once, so it
    // is offered on one row per repair, and only once nothing is outstanding.
    let arrivalOffered = false
    for (const request of requests) {
      const step = partsStep(request, repair.status)
      if (!step) continue
      if (step === 'mark_arrived') {
        const stillOpen = requests.some(r => r.status === 'pending' || r.status === 'ordered')
        if (stillOpen || arrivalOffered) continue
        arrivalOffered = true
      }
      rows.push({
        repairId: repair.id,
        repairRef: repair.ref,
        device: repair.productName ?? '',
        customerName: repair.customerName ?? '',
        repairStatus: repair.status,
        request,
        step,
        ageDays: daysBetween(request.requestedDate, today),
      })
    }
  }
  return rows.sort((a, b) =>
    (URGENCY_RANK[a.request.urgency] ?? 2) - (URGENCY_RANK[b.request.urgency] ?? 2)
    || b.ageDays - a.ageDays
    || a.repairRef.localeCompare(b.repairRef))
}

/**
 * Step 1: the system says the warehouse holds some of a part the technician
 * could not find. Until the count is corrected (or confirmed right), the part
 * is not ordered — the desk checks the shelf first.
 */
export function needsCountCorrection(request: PartsRequest, productId: string, systemQty: number): boolean {
  if (!productId || systemQty <= 0) return false
  return !(request.countCheckedProductIds ?? []).includes(productId)
}

/** How many a correction may take off: what the system shows, no more. */
export function countCorrectionBlocker(systemQty: number, qtyMissing: number): string | null {
  if (systemQty <= 0) return 'The system shows none in the warehouse — nothing to correct'
  if (!Number.isFinite(qtyMissing) || qtyMissing <= 0) return 'Enter how many the system shows that are not on the shelf'
  if (qtyMissing > systemQty) return `The system only shows ${systemQty}`
  return null
}

export function requestAfterCountCheck(request: PartsRequest, productId: string, adjustmentRef?: string): PartsRequest {
  const checked = new Set(request.countCheckedProductIds ?? [])
  checked.add(productId)
  return {
    ...request,
    countCheckedProductIds: [...checked],
    ...(adjustmentRef ? { adjustmentRefs: [...(request.adjustmentRefs ?? []), adjustmentRef] } : {}),
  }
}

type OrderLine = { productId: string; productName: string; qty: number; unitPrice: number }

/**
 * Step 2. `systemQtyFor` is what the system shows in the warehouse for a
 * product; any line still showing stock the desk has not checked waits for
 * step 1.
 */
export function purchaseOrderBlocker(
  request: PartsRequest,
  vendorId: string,
  lines: OrderLine[],
  systemQtyFor: (productId: string) => number,
): string | null {
  if (request.status !== 'pending') return 'This request has already been ordered'
  if (!vendorId) return 'Choose the vendor the parts are bought from'
  if (!lines.length) return 'Add at least one part to the order'
  for (const line of lines) {
    if (!line.productId) return `Pick the catalogue product for "${line.productName || 'a line'}"`
    if (!Number.isFinite(line.qty) || line.qty <= 0) return `Enter the quantity for ${line.productName}`
    if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0) return `Enter the price for ${line.productName}`
    const systemQty = systemQtyFor(line.productId)
    if (needsCountCorrection(request, line.productId, systemQty)) {
      return `The system shows ${systemQty} × ${line.productName} in the warehouse — check the shelf and correct the count first`
    }
  }
  return null
}

export function requestAfterPurchaseOrder(request: PartsRequest, po: { id: string; ref: string }, today: string): PartsRequest {
  return {
    ...request,
    status: 'ordered',
    purchaseOrderId: po.id,
    orderReference: po.ref,
    orderedDate: today,
  }
}

/** The note on the count correction, so the ledger says why stock went down. */
export function countCorrectionNote(repairRef: string, request: Pick<PartsRequest, 'requestedByName'>): string {
  return `Not on the shelf — ${request.requestedByName} requested it for repair ${repairRef} and it could not be found`
}

/** The purchase order's note: which repair it is for, so the GRN clerk knows. */
export function partsOrderNote(repair: Pick<RepairForParts, 'ref' | 'productName'>, request: Pick<PartsRequest, 'urgency' | 'notes'>): string {
  const device = repair.productName ? ` — ${repair.productName}` : ''
  const extra = request.notes?.trim() ? ` ${request.notes.trim()}` : ''
  return `Parts for repair ${repair.ref}${device} (${request.urgency || 'normal'} urgency). Receiving this order puts the repair back to work.${extra}`
}

/** Who may correct counts — the same roles that may request stock adjustments. */
export const PARTS_ADJUST_ROLES = ['director', 'inventory_officer', 'technical_lead', 'finance_officer']
/** Who may raise the purchase order — the same roles that may create one. */
export const PARTS_ORDER_ROLES = ['director', 'admin_officer', 'inventory_officer']
export const PARTS_ARRIVED_ROLES = ['director', 'technical_lead', 'inventory_officer', 'inventory', 'admin_officer']
