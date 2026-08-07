/**
 * Debounced Prisma flush for draft quotation line edits.
 * Add/remove/reorder stay optimistic in the UI, then this writes them through
 * updateSaleOrder({ persist: true }) so a notes keystroke / SSE cannot restore
 * the previous line set.
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
    opts?: { persist?: boolean },
  ) => Promise<boolean | void> | boolean | void
  getSaleOrder?: (id: string) => SaleOrderLike | undefined
}

let api: PersistApi | null = null
const timers = new Map<string, ReturnType<typeof setTimeout>>()

export function registerSaleOrderDraftPersistApi(next: PersistApi | null) {
  api = next
}

export function scheduleDraftSaleOrderLinePersist(orderId: string) {
  if (!orderId || typeof window === 'undefined') return
  const prev = timers.get(orderId)
  if (prev) clearTimeout(prev)
  timers.set(orderId, setTimeout(() => {
    timers.delete(orderId)
    const current = api
    if (!current || !isSaleOrderDraftEditing(orderId)) return
    const live = current.getSaleOrder?.(orderId)
    if (!live) return
    void current.updateSaleOrder(orderId, {
      lines: live.lines,
      subtotal: live.subtotal,
      taxTotal: live.taxTotal,
      discountAmount: live.discountAmount,
      total: live.total,
    }, { persist: true })
  }, 450))
}

/** Test helper */
export function _resetDraftSaleOrderPersistForTests() {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  api = null
}
