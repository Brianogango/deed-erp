/**
 * Debounced Prisma flush for draft quotation line edits.
 * Soft auto-persist never rolls the UI back and never clears draft protection —
 * only an explicit Save stamps the row. Overlapping PATCHes are coalesced so an
 * older response cannot restore deleted lines.
 */

import {
  isSaleOrderDraftEditing,
} from '@/lib/sale-order-draft-edits'

type SaleOrderLike = {
  id: string
  lines: unknown
  subtotal?: number
  taxTotal?: number
  discountAmount?: number
  total?: number
}

type PersistApi = {
  updateSaleOrder: (
    id: string,
    patch: Record<string, unknown>,
    opts?: { persist?: boolean; soft?: boolean },
  ) => Promise<boolean | void> | boolean | void
  getSaleOrder?: (id: string) => SaleOrderLike | undefined
}

let api: PersistApi | null = null
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const inflight = new Set<string>()
const queued = new Set<string>()

export function registerSaleOrderDraftPersistApi(next: PersistApi | null) {
  api = next
}

async function flushDraftSaleOrderLinePersist(orderId: string) {
  const current = api
  if (!current || !isSaleOrderDraftEditing(orderId)) return
  const live = current.getSaleOrder?.(orderId)
  if (!live) return
  inflight.add(orderId)
  try {
    await current.updateSaleOrder(orderId, {
      lines: live.lines,
      subtotal: live.subtotal,
      taxTotal: live.taxTotal,
      discountAmount: live.discountAmount,
      total: live.total,
    }, { persist: true, soft: true })
  } finally {
    inflight.delete(orderId)
    if (queued.has(orderId)) {
      queued.delete(orderId)
      scheduleDraftSaleOrderLinePersist(orderId)
    }
  }
}

export function scheduleDraftSaleOrderLinePersist(orderId: string) {
  if (!orderId || typeof window === 'undefined') return
  if (inflight.has(orderId)) {
    queued.add(orderId)
    return
  }
  const prev = timers.get(orderId)
  if (prev) clearTimeout(prev)
  timers.set(orderId, setTimeout(() => {
    timers.delete(orderId)
    void flushDraftSaleOrderLinePersist(orderId)
  }, 450))
}

/** True while a soft persist PATCH is in flight for this order. */
export function isDraftSaleOrderPersistInFlight(orderId: string) {
  return inflight.has(orderId)
}

/** Test helper */
export function _resetDraftSaleOrderPersistForTests() {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  inflight.clear()
  queued.clear()
  api = null
}
