/**
 * POS ticket list merge + receipt numbering.
 *
 * Till tickets live in the `deed_posOrders` blob. A stale tab / SSE payload
 * used to *replace* that array, which dropped sales that Prisma invoices had
 * already posted. Union-by-id so existing tickets cannot disappear.
 *
 * Receipt refs are `POS/NNNN` (no year) and must not share a counter with
 * `POSSESS/NNNN` session refs — those previously used the same localStorage key.
 */

import { safeLocalStorageSet } from '@/lib/client-store-cache'

export type PosOrderLike = {
  id?: unknown
  ref?: unknown
  [key: string]: unknown
}

function asId(row: PosOrderLike): string | null {
  const id = row?.id
  if (id == null) return null
  const s = String(id).trim()
  return s || null
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function asLineObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/**
 * Keep a serial that only one side has. A stale till tab often re-sends the
 * restored 14 Aug tickets without SN; the server copy must not lose it.
 */
export function mergePosOrderLines(currentLines: unknown, incomingLines: unknown): unknown {
  if (!Array.isArray(incomingLines)) return currentLines
  if (!Array.isArray(currentLines) || currentLines.length === 0) return incomingLines

  const used = new Set<number>()
  return incomingLines.map((raw, index) => {
    const incoming = asLineObject(raw)
    if (!incoming) return raw

    let prevIndex = -1
    const incomingSerialId = asNonEmptyString(incoming.serialId)
    const incomingProductId = asNonEmptyString(incoming.productId)
    if (incomingSerialId) {
      prevIndex = currentLines.findIndex((line, i) => {
        if (used.has(i)) return false
        return asNonEmptyString(asLineObject(line)?.serialId) === incomingSerialId
      })
    }
    if (prevIndex < 0 && incomingProductId) {
      prevIndex = currentLines.findIndex((line, i) => {
        if (used.has(i)) return false
        return asNonEmptyString(asLineObject(line)?.productId) === incomingProductId
      })
    }
    if (prevIndex < 0 && index < currentLines.length && !used.has(index)) prevIndex = index
    if (prevIndex >= 0) used.add(prevIndex)

    const previous = prevIndex >= 0 ? asLineObject(currentLines[prevIndex]) : null
    const next = { ...(previous ?? {}), ...incoming }
    const currentSerial = asNonEmptyString(previous?.serialNumber)
    const currentSerialId = asNonEmptyString(previous?.serialId)
    if (!asNonEmptyString(incoming.serialNumber) && currentSerial) next.serialNumber = currentSerial
    if (!asNonEmptyString(incoming.serialId) && currentSerialId) next.serialId = currentSerialId
    return next
  })
}

function mergePosOrderRow(current: PosOrderLike | undefined, incoming: PosOrderLike): PosOrderLike {
  const merged: PosOrderLike = { ...(current ?? {}), ...incoming }
  if (current && ('lines' in current || 'lines' in incoming)) {
    merged.lines = mergePosOrderLines(current.lines, incoming.lines)
  }
  return merged
}

/**
 * Reconcile a dirty till tab with the server blob. Local field updates win,
 * but serials (and server-only tickets) are kept.
 */
export function mergeDirtyPosOrdersBlob(localStr: string | null | undefined, remoteStr: string): string {
  let local: unknown = []
  let remote: unknown = []
  try {
    if (localStr) local = JSON.parse(localStr)
  } catch {
    local = []
  }
  try {
    remote = JSON.parse(remoteStr)
  } catch {
    return localStr || remoteStr
  }
  return JSON.stringify(mergePosOrdersStoreWrite(remote, local))
}

function parsePosSeq(ref: unknown, prefix: string): number {
  if (typeof ref !== 'string') return 0
  const m = new RegExp(`^${prefix}/(\\d+)$`).exec(ref.trim())
  if (!m) return 0
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) ? n : 0
}

export function nextPrefixedRef(prefix: string, existingRefs: string[], storageKey: string): string {
  let max = 0
  for (const ref of existingRefs) {
    const n = parsePosSeq(ref, prefix)
    if (n > max) max = n
  }
  if (typeof window !== 'undefined') {
    const stored = parseInt(localStorage.getItem(storageKey) ?? '0', 10)
    if (Number.isFinite(stored) && stored > max) max = stored
  }
  const next = max + 1
  safeLocalStorageSet(storageKey, String(next))
  return `${prefix}/${String(next).padStart(4, '0')}`
}

/** Next POS receipt number, continuing from tickets already on the till. */
export function nextPosTicketRef(existingRefs: string[]): string {
  return nextPrefixedRef('POS', existingRefs, 'deed_seq2_pos_ticket')
}

/** Next POS session number — separate high-water from ticket refs. */
export function nextPosSessionRef(existingRefs: string[]): string {
  return nextPrefixedRef('POSSESS', existingRefs, 'deed_seq2_possess')
}

/**
 * Union store writes so a stale shorter list cannot drop POS tickets.
 * Incoming rows update matching ids; server-only ids are kept; incoming-only
 * ids are appended. Empty incoming leaves current unchanged.
 */
export function mergePosOrdersStoreWrite(current: unknown, incoming: unknown): PosOrderLike[] {
  const currentArr: PosOrderLike[] = Array.isArray(current) ? current.filter(Boolean) : []
  if (!Array.isArray(incoming)) return currentArr
  if (incoming.length === 0) return currentArr

  const incomingArr = incoming.filter((row): row is PosOrderLike => Boolean(row && typeof row === 'object'))
  const currentById = new Map<string, PosOrderLike>()
  for (const row of currentArr) {
    const id = asId(row)
    if (id) currentById.set(id, row)
  }
  const incomingById = new Map<string, PosOrderLike>()
  for (const row of incomingArr) {
    const id = asId(row)
    if (id) incomingById.set(id, row)
  }

  const seen = new Set<string>()
  const merged: PosOrderLike[] = []
  // Prefer incoming order (newest tickets first) then append server-only rows.
  for (const row of incomingArr) {
    const id = asId(row)
    if (!id || seen.has(id)) continue
    seen.add(id)
    merged.push(mergePosOrderRow(currentById.get(id), row))
  }
  for (const row of currentArr) {
    const id = asId(row)
    if (!id || seen.has(id)) continue
    seen.add(id)
    merged.push(row)
  }
  return merged
}

/**
 * Apply an SSE / cross-tab POS payload without dropping local tickets.
 * Returns the previous array reference when unchanged so React skips re-renders.
 */
export function mergePosOrdersRemoteState<P extends { id?: string }>(local: P[], remote: P[]): P[] {
  const merged = mergePosOrdersStoreWrite(local, remote) as P[]
  if (!Array.isArray(merged)) return local
  return JSON.stringify(merged) === JSON.stringify(local) ? local : merged
}
