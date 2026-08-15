/**
 * POS till session helpers — keep open/close resilient when blob keys drift.
 *
 * Historical bug: `deed_posSessionOpen=true` could persist without
 * `deed_posSessionId`, so the Retail Till UI stayed open but Close Session
 * always failed with "No open POS session".
 *
 * A till that was opened stays open until Close Session. Missing ids are
 * recovered from session history (including overnight); they are never
 * treated as a reason to close the till.
 */

export type PosSessionLike = {
  id: string
  status: 'open' | 'closed' | string
  openedAt?: string
  closedAt?: string
  [key: string]: unknown
}

function asSessionId(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s || null
}

function asSessionRow(value: unknown): PosSessionLike | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const id = asSessionId((value as { id?: unknown }).id)
  if (!id) return null
  return { ...(value as PosSessionLike), id }
}

/** Find a usable session id when flags and history disagree. */
export function resolveOpenPosSessionId(opts: {
  posSessionOpen: boolean
  posSessionId: string | null | undefined
  posSessions: PosSessionLike[]
}): string | null {
  const explicit = typeof opts.posSessionId === 'string' ? opts.posSessionId.trim() : ''
  if (explicit) {
    const match = opts.posSessions.find(s => s.id === explicit)
    if (!match) return explicit
    if (match.status === 'open') return explicit
    if (opts.posSessionOpen) {
      const open = opts.posSessions.find(s => s.status === 'open' && s.id)
      if (open?.id) return open.id
    }
    return null
  }
  if (!opts.posSessionOpen) return null
  const open = opts.posSessions.find(s => s.status === 'open' && s.id)
  return open?.id ?? null
}

/**
 * Union store writes so a stale tab cannot drop the live till.
 * Incoming rows update matching ids (Close Session still works).
 * Server-only ids — including an open session the client omitted — are kept.
 */
export function mergePosSessionsStoreWrite(current: unknown, incoming: unknown): PosSessionLike[] {
  const currentArr = Array.isArray(current)
    ? current.map(asSessionRow).filter((row): row is PosSessionLike => Boolean(row))
    : []
  if (!Array.isArray(incoming)) return currentArr
  if (incoming.length === 0) return currentArr

  const incomingArr = incoming.map(asSessionRow).filter((row): row is PosSessionLike => Boolean(row))
  const currentById = new Map(currentArr.map(row => [row.id, row]))
  const seen = new Set<string>()
  const merged: PosSessionLike[] = []

  for (const row of incomingArr) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    const previous = currentById.get(row.id)
    merged.push(previous ? { ...previous, ...row, id: row.id } : row)
  }
  for (const row of currentArr) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    merged.push(row)
  }
  return merged
}

export function mergePosSessionsRemoteState<P extends { id?: string }>(local: P[], remote: P[]): P[] {
  const merged = mergePosSessionsStoreWrite(local, remote) as P[]
  if (!Array.isArray(merged)) return local
  return JSON.stringify(merged) === JSON.stringify(local) ? local : merged
}

/**
 * After merging session history, do not let a stale tab switch the live till
 * onto an older session id. Close Session still wins when that same id is
 * closed in the merged list (`pinLiveTill` is then false).
 */
export function reconcileOpenPosSessionFlags(opts: {
  currentOpen: boolean
  currentId: string | null | undefined
  incomingOpen?: boolean
  incomingId?: string | null
  mergedSessions: PosSessionLike[]
}): { pinLiveTill: boolean; posSessionOpen: boolean; posSessionId: string | null } {
  const currentId = asSessionId(opts.currentId)
  const incomingId = opts.incomingId === undefined ? undefined : asSessionId(opts.incomingId)
  const currentRow = currentId ? opts.mergedSessions.find(s => s.id === currentId) : undefined
  const currentStillOpen = Boolean(opts.currentOpen && currentRow?.status === 'open')

  if (currentStillOpen && currentId) {
    return { pinLiveTill: true, posSessionOpen: true, posSessionId: currentId }
  }

  const incomingRow = incomingId ? opts.mergedSessions.find(s => s.id === incomingId) : undefined
  if (incomingRow?.status === 'open' && incomingId) {
    return { pinLiveTill: false, posSessionOpen: true, posSessionId: incomingId }
  }

  const recovered = resolveOpenPosSessionId({
    posSessionOpen: opts.incomingOpen ?? opts.currentOpen,
    posSessionId: incomingId ?? currentId,
    posSessions: opts.mergedSessions,
  })
  if (recovered) {
    return { pinLiveTill: false, posSessionOpen: true, posSessionId: recovered }
  }

  return {
    pinLiveTill: false,
    posSessionOpen: opts.incomingOpen ?? false,
    posSessionId: incomingId ?? null,
  }
}

/** Open flag set but no recoverable session id — Close cannot settle normally. */
export function isOrphanedPosSession(opts: {
  posSessionOpen: boolean
  posSessionId: string | null | undefined
  posSessions: PosSessionLike[]
}): boolean {
  return Boolean(opts.posSessionOpen) && !resolveOpenPosSessionId(opts)
}

/** True when an open attempt should be blocked because a real session is live. */
export function hasActivePosSession(opts: {
  posSessionOpen: boolean
  posSessionId: string | null | undefined
  posSessions: PosSessionLike[]
}): boolean {
  return Boolean(resolveOpenPosSessionId(opts))
}

/** POS tender that settles to a company bank account (`card` is legacy). */
export function isPosBankPayment(payment?: string): boolean {
  return payment === 'bank' || payment === 'card'
}
