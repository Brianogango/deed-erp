/**
 * Repair ticket numbers.
 *
 * Staff booking used to mint a local timestamp ref (`REP-227532`) and share the
 * portal link immediately. POST /api/repairs then replaced it with the sequential
 * counter (`REP/0275`), so clients kept a dead URL. Official refs must be allocated
 * before the share screen, and old timestamp URLs must still resolve.
 */

export function isOfficialRepairRef(ref: unknown): boolean {
  return /^REP\/\d{4,}(?:\/\d{4,})?$/i.test(String(ref ?? '').trim())
}

export function isTemporaryRepairRef(ref: unknown): boolean {
  return /^REP-\d{5,6}$/i.test(String(ref ?? '').trim())
}

export function inferredTemporaryRepairRef(intakeDate: unknown): string | null {
  const ms = typeof intakeDate === 'number'
    ? intakeDate
    : Date.parse(String(intakeDate ?? ''))
  if (!Number.isFinite(ms)) return null
  return `REP-${String(Math.trunc(ms)).slice(-6)}`
}

export function uniqueRepairRefs(refs: Array<unknown>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of refs) {
    const value = String(raw ?? '').trim()
    if (!value) continue
    const key = value.toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

export function normalizePortalRepairRef(raw: unknown): string {
  return decodeURIComponent(String(raw ?? '').trim())
}

export function collectStoredRepairRefAliases(repair: {
  ref?: unknown
  previousRefs?: unknown
}): string[] {
  const previous = Array.isArray(repair.previousRefs) ? repair.previousRefs : []
  return uniqueRepairRefs([repair.ref, ...previous])
}

export function findRepairByPortalRef<T extends {
  ref?: unknown
  previousRefs?: unknown
  intakeDate?: unknown
  createdDate?: unknown
}>(repairs: T[], rawRef: unknown): T | null {
  const wanted = normalizePortalRepairRef(rawRef).toUpperCase()
  if (!wanted) return null

  const exact = repairs.find(repair => String(repair.ref ?? '').toUpperCase() === wanted)
  if (exact) return exact

  const byPrevious = repairs.find(repair =>
    Array.isArray(repair.previousRefs)
    && repair.previousRefs.some(alias => String(alias).toUpperCase() === wanted),
  )
  if (byPrevious) return byPrevious

  // Jobs booked before the sequential counter kept the timestamp ref on the
  // share screen (`REP-227532`) then swapped to `REP/0275`. Reconstruct that
  // alias from intake time only when it would not collide with a live ticket.
  if (!isTemporaryRepairRef(wanted)) return null
  const inferred = repairs.filter(repair =>
    isOfficialRepairRef(repair.ref)
    && inferredTemporaryRepairRef(repair.intakeDate ?? repair.createdDate)?.toUpperCase() === wanted,
  )
  return inferred.length === 1 ? inferred[0] : null
}
