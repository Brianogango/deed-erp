/**
 * POS till session helpers — keep open/close resilient when blob keys drift.
 *
 * Historical bug: `deed_posSessionOpen=true` could persist without
 * `deed_posSessionId`, so the Retail Till UI stayed open but Close Session
 * always failed with "No open POS session".
 */

/** Overnight leftover open rows (e.g. POSSESS/0013 from days ago) are not a live till. */
export const STALE_OPEN_POS_SESSION_MS = 18 * 60 * 60 * 1000

export type PosSessionLike = {
  id: string
  status: 'open' | 'closed' | string
  openedAt?: string
  closedAt?: string
}

export function isStaleOpenPosSession(session: PosSessionLike, nowMs = Date.now()): boolean {
  if (session.status !== 'open') return false
  if (!session.openedAt) return false
  const opened = Date.parse(session.openedAt)
  if (!Number.isFinite(opened)) return false
  return nowMs - opened > STALE_OPEN_POS_SESSION_MS
}

/** Find a usable session id when flags and history disagree. */
export function resolveOpenPosSessionId(opts: {
  posSessionOpen: boolean
  posSessionId: string | null | undefined
  posSessions: PosSessionLike[]
  nowMs?: number
}): string | null {
  const explicit = typeof opts.posSessionId === 'string' ? opts.posSessionId.trim() : ''
  if (explicit) return explicit
  if (!opts.posSessionOpen) return null
  const nowMs = opts.nowMs ?? Date.now()
  const open = opts.posSessions.find(s => s.status === 'open' && s.id && !isStaleOpenPosSession(s, nowMs))
  return open?.id ?? null
}

/** Mark leftover `status: open` history rows closed so they cannot be recovered as a live till. */
export function abandonStaleOpenPosSessions<T extends PosSessionLike>(
  sessions: T[],
  keepId?: string | null,
  nowMs = Date.now(),
): T[] {
  let changed = false
  const closedAt = new Date(nowMs).toISOString()
  const next = sessions.map(session => {
    if (keepId && session.id === keepId) return session
    if (!isStaleOpenPosSession(session, nowMs)) return session
    changed = true
    return { ...session, status: 'closed' as const, closedAt }
  })
  return changed ? next : sessions
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

