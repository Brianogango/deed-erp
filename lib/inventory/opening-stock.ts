/**
 * Opening-stock detection and lock helpers.
 *
 * The lock flag (`deed_openingStockPosted`) can diverge from actual OPENING
 * stock moves when stock was seeded via ops scripts or the flag failed to sync.
 * Treat either signal as "already posted".
 */

export type OpeningStockMoveLike = {
  type?: string | null
  documentRef?: string | null
  reason?: string | null
}

export function isOpeningStockMove(move: OpeningStockMoveLike): boolean {
  if (String(move.type || '') !== 'in') return false
  const ref = String(move.documentRef || '').trim().toUpperCase()
  const reason = String(move.reason || '').toLowerCase()
  return (
    ref === 'OPENING'
    || ref.startsWith('OPENING-')
    || reason.includes('opening stock')
  )
}

export function hasOpeningStockMoves(moves: OpeningStockMoveLike[]): boolean {
  return moves.some(isOpeningStockMove)
}

/** True when the explicit lock flag is set or opening moves already exist. */
export function isOpeningStockLocked(
  postedFlag: boolean | null | undefined,
  moves: OpeningStockMoveLike[],
): boolean {
  return postedFlag === true || hasOpeningStockMoves(moves)
}
