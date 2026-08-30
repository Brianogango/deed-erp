/**
 * Repair ticket numbers.
 *
 * New official tickets are an unguessable `REP-` + 8 Crockford characters
 * (`REP-7K3M9X2Q`). A sequential counter (`REP/0275`) was used for uniqueness
 * and made portal URLs enumerable — keep recognising those forever, plus the
 * older timestamp placeholders (`REP-227532`) stored as previousRefs.
 */

export const RANDOM_REPAIR_REF_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
export const RANDOM_REPAIR_REF_LENGTH = 8

const RANDOM_REPAIR_REF_RE = new RegExp(
  `^REP-[${RANDOM_REPAIR_REF_ALPHABET}]{${RANDOM_REPAIR_REF_LENGTH}}$`,
  'i',
)
const SEQUENTIAL_REPAIR_REF_RE = /^REP\/\d{4,}(?:\/\d{4,})?$/i

/** Sequential, year-prefixed, or random official ticket in free text. */
export const REPAIR_REF_IN_TEXT_RE = new RegExp(
  String.raw`\bREP\/\d{4}\/\d+\b|\bREP\/\d+\b|\bREP-[${RANDOM_REPAIR_REF_ALPHABET}]{${RANDOM_REPAIR_REF_LENGTH}}\b`,
  'i',
)

export function isSequentialRepairRef(ref: unknown): boolean {
  return SEQUENTIAL_REPAIR_REF_RE.test(String(ref ?? '').trim())
}

export function isRandomRepairRef(ref: unknown): boolean {
  return RANDOM_REPAIR_REF_RE.test(String(ref ?? '').trim())
}

export function isOfficialRepairRef(ref: unknown): boolean {
  return isSequentialRepairRef(ref) || isRandomRepairRef(ref)
}

export function mintRandomRepairRef(
  randomBytes: (size: number) => Uint8Array = defaultRandomBytes,
): string {
  const bytes = randomBytes(RANDOM_REPAIR_REF_LENGTH)
  if (bytes.length < RANDOM_REPAIR_REF_LENGTH) {
    throw new Error('Insufficient entropy for a repair reference')
  }
  let token = ''
  for (let i = 0; i < RANDOM_REPAIR_REF_LENGTH; i++) {
    token += RANDOM_REPAIR_REF_ALPHABET[bytes[i]! & 31]
  }
  return `REP-${token}`
}

function defaultRandomBytes(size: number): Uint8Array {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.getRandomValues) {
    throw new Error('Secure random generator is not available')
  }
  return cryptoApi.getRandomValues(new Uint8Array(size))
}

export function takenRepairRefs(repairs: Array<{ ref?: unknown; previousRefs?: unknown }>): string[] {
  return uniqueRepairRefs(repairs.flatMap(repair => collectStoredRepairRefAliases(repair)))
}

export function allocateRepairRef(taken: Iterable<string> = []): string {
  const used = new Set(
    [...taken].map(value => String(value ?? '').trim().toUpperCase()).filter(Boolean),
  )
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const ref = mintRandomRepairRef()
    if (!used.has(ref.toUpperCase())) return ref
  }
  throw new Error('Failed to allocate a unique repair reference')
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

  // Jobs booked before an official ticket was allocated kept the timestamp
  // ref on the share screen (`REP-227532`) then swapped to `REP/0275`.
  // Reconstruct that alias from intake time only when it would not collide.
  if (!isTemporaryRepairRef(wanted)) return null
  const inferred = repairs.filter(repair =>
    isOfficialRepairRef(repair.ref)
    && inferredTemporaryRepairRef(repair.intakeDate ?? repair.createdDate)?.toUpperCase() === wanted,
  )
  return inferred.length === 1 ? inferred[0] : null
}
