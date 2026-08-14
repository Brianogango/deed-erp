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
  if (typeof window !== 'undefined') localStorage.setItem(storageKey, String(next))
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
    merged.push({ ...(currentById.get(id) ?? {}), ...row })
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
