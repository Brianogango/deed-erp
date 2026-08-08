/**
 * Single-flight draft quotation line persist.
 *
 * Soft auto-persist and explicit Save must never PATCH the same SO concurrently:
 * a slower soft write was restoring previous lines in Prisma/blob after Save.
 *
 * Soft updates Prisma with skipBroadcast so mid-edit snapshots do not rewrite
 * the shared deed_saleOrders blob. Save cancels soft work, waits for idle,
 * then PATCHes and broadcasts.
 *
 * Soft flushes are chained (never overlapping). Replacing the inflight map entry
 * without awaiting the previous PATCH allowed Soft#1 (A+B) to finish after Soft#2
 * (A) and resurrect deleted lines in the database.
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
/** Tail of the soft-persist chain for each order (always awaited by the next). */
const inflight = new Map<string, Promise<void>>()
const hardSaving = new Set<string>()
/** Bumped whenever a newer edit/Save supersedes in-flight soft work. */
const generation = new Map<string, number>()

export function registerSaleOrderDraftPersistApi(next: PersistApi | null) {
  api = next
}

function bumpGeneration(orderId: string): number {
  const next = (generation.get(orderId) ?? 0) + 1
  generation.set(orderId, next)
  return next
}

export function getSaleOrderPersistGeneration(orderId: string): number {
  return generation.get(orderId) ?? 0
}

export function isSaleOrderHardSaving(orderId: string) {
  return hardSaving.has(orderId)
}

/** Cancel debounced soft persist — does not abort an HTTP request already sent. */
export function cancelDraftSaleOrderLinePersist(orderId: string) {
  if (!orderId) return
  const prev = timers.get(orderId)
  if (prev) clearTimeout(prev)
  timers.delete(orderId)
  bumpGeneration(orderId)
}

/** Wait until the entire soft-persist chain for this order finishes. */
export async function waitForDraftSaleOrderPersistIdle(orderId: string) {
  const pending = inflight.get(orderId)
  if (pending) await pending
}

export function beginHardSaleOrderPersist(orderId: string) {
  hardSaving.add(orderId)
  cancelDraftSaleOrderLinePersist(orderId)
}

export function endHardSaleOrderPersist(orderId: string) {
  hardSaving.delete(orderId)
}

/**
 * Enqueue soft work so PATCHes for one SO never overlap.
 * Previous implementations replaced `inflight` and dropped the prior promise,
 * so waitForIdle + last-writer races let stale A+B land after A.
 */
function enqueueSoftPersist(orderId: string, run: () => Promise<void>) {
  const prev = inflight.get(orderId) ?? Promise.resolve()
  const wrapped = prev
    .catch(() => {})
    .then(run)
    .catch(() => {})
    .finally(() => {
      if (inflight.get(orderId) === wrapped) inflight.delete(orderId)
    })
  inflight.set(orderId, wrapped)
  return wrapped
}

async function flushDraftSaleOrderLinePersist(orderId: string, startedGen: number) {
  const current = api
  if (!current || !isSaleOrderDraftEditing(orderId)) return
  if (hardSaving.has(orderId)) return
  if ((generation.get(orderId) ?? 0) !== startedGen) return
  const live = current.getSaleOrder?.(orderId)
  if (!live) return
  // Re-check after reading live state — a delete/Save may have landed.
  if (hardSaving.has(orderId)) return
  if ((generation.get(orderId) ?? 0) !== startedGen) return

  await current.updateSaleOrder(orderId, {
    lines: live.lines,
    subtotal: live.subtotal,
    taxTotal: live.taxTotal,
    discountAmount: live.discountAmount,
    total: live.total,
    // Server skips blob rewrite for soft line flushes (Save broadcasts).
    skipBroadcast: true,
  }, { persist: true, soft: true })
}

export function scheduleDraftSaleOrderLinePersist(orderId: string) {
  if (!orderId || typeof window === 'undefined') return
  if (hardSaving.has(orderId)) return
  const prev = timers.get(orderId)
  if (prev) clearTimeout(prev)
  const startedGen = bumpGeneration(orderId)
  timers.set(orderId, setTimeout(() => {
    timers.delete(orderId)
    enqueueSoftPersist(orderId, () => flushDraftSaleOrderLinePersist(orderId, startedGen))
  }, 450))
}

export function isDraftSaleOrderPersistInFlight(orderId: string) {
  return inflight.has(orderId) || timers.has(orderId)
}

/** Test helper */
export function _resetDraftSaleOrderPersistForTests() {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  inflight.clear()
  hardSaving.clear()
  generation.clear()
  api = null
}
