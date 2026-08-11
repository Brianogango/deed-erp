/**
 * POS till session helpers — keep open/close resilient when blob keys drift.
 *
 * Historical bug: `deed_posSessionOpen=true` could persist without
 * `deed_posSessionId`, so the Retail Till UI stayed open but Close Session
 * always failed with "No open POS session".
 */

export type PosSessionLike = {
  id: string
  status: 'open' | 'closed' | string
  openedAt?: string
}

/** Find a usable session id when flags and history disagree. */
export function resolveOpenPosSessionId(opts: {
  posSessionOpen: boolean
  posSessionId: string | null | undefined
  posSessions: PosSessionLike[]
}): string | null {
  const explicit = typeof opts.posSessionId === 'string' ? opts.posSessionId.trim() : ''
  if (explicit) return explicit
  if (!opts.posSessionOpen) return null
  const open = opts.posSessions.find(s => s.status === 'open' && s.id)
  return open?.id ?? null
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
