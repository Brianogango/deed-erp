import { isUUID } from '@/lib/utils'

/**
 * The single definition of how a contact person crosses the wire.
 *
 * Previously the mapping existed only in the write direction and only inside
 * the route: it renamed jobTitle → position on the way in, and nothing renamed
 * it back on the way out. Since the server broadcasts the whole table into
 * deed_contactPersons, the first sync after any write replaced every contact
 * person in the browser with a row whose jobTitle was undefined — blank job
 * titles in the contact panel, "Name (undefined)" in the opportunity picker,
 * and silent mis-scoring in LeadScore, which reads jobTitle to judge seniority.
 * Fields with no column at all (mobile, linkedIn, the role flags, preferred
 * channel, department) simply disappeared.
 *
 * Both directions live here now so they cannot drift apart again.
 */

/** Column widths from prisma/schema.prisma. A VarChar overflow errors, so clamp. */
const LIMITS = {
  firstName: 80,
  lastName: 80,
  email: 150,
  phone: 40,
  mobile: 40,
  position: 100,
  department: 100,
  linkedIn: 200,
  preferredChannel: 20,
} as const

const PREFERRED_CHANNELS = new Set(['email', 'phone', 'whatsapp'])

function text(value: unknown, max: number): string | null {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

function bool(value: unknown): boolean {
  return value === true
}

export type ContactPersonWriteError = string

/**
 * App shape → database columns.
 *
 * `partial` is for PATCH/PUT: only keys present in the body are returned, so an
 * edit of one field cannot blank the others.
 */
export function contactPersonToDb(
  body: Record<string, any>,
  opts: { partial?: boolean; includeId?: boolean } = {},
): Record<string, unknown> | ContactPersonWriteError {
  const full = !opts.partial
  const has = (...keys: string[]) => keys.some(k => body[k] !== undefined)
  const data: Record<string, unknown> = {}

  if (full || has('clientId', 'companyId')) {
    const clientId = body.clientId ?? body.companyId
    // clientId is a required uuid column. Unguarded, an empty or legacy value
    // reached Postgres as `invalid input syntax for type uuid` — a 500 that the
    // client's fire-and-forget sync threw away.
    if (!isUUID(clientId)) {
      return 'A contact person must belong to a saved company.'
    }
    data.clientId = clientId
  }

  if (full || has('firstName')) {
    const firstName = text(body.firstName, LIMITS.firstName)
    if (full && !firstName) return 'First name is required.'
    if (firstName !== null || full) data.firstName = firstName ?? ''
  }
  if (full || has('lastName')) {
    const lastName = text(body.lastName, LIMITS.lastName)
    if (full && !lastName) return 'Last name is required.'
    if (lastName !== null || full) data.lastName = lastName ?? ''
  }

  if (full || has('email')) data.email = text(body.email, LIMITS.email)
  if (full || has('phone')) data.phone = text(body.phone, LIMITS.phone)
  if (full || has('mobile')) data.mobile = text(body.mobile, LIMITS.mobile)
  if (full || has('position', 'jobTitle')) {
    data.position = text(body.position ?? body.jobTitle, LIMITS.position)
  }
  if (full || has('department')) data.department = text(body.department, LIMITS.department)
  if (full || has('linkedIn')) data.linkedIn = text(body.linkedIn, LIMITS.linkedIn)
  if (full || has('notes')) data.notes = text(body.notes, 10_000)

  if (full || has('isPrimary')) data.isPrimary = bool(body.isPrimary)
  if (full || has('isDecisionMaker')) data.isDecisionMaker = bool(body.isDecisionMaker)
  if (full || has('isTechnicalContact')) data.isTechnicalContact = bool(body.isTechnicalContact)
  if (full || has('isBillingContact')) data.isBillingContact = bool(body.isBillingContact)

  if (full || has('preferredChannel')) {
    const channel = text(body.preferredChannel, LIMITS.preferredChannel)?.toLowerCase() ?? null
    data.preferredChannel = channel && PREFERRED_CHANNELS.has(channel) ? channel : null
  }

  // Keep the id the browser minted, exactly as contactToClientData does for
  // contacts. Without it Postgres issued its own, the record changed identity
  // under the open screen, and every later edit or delete addressed a row that
  // did not exist — failing silently.
  if (opts.includeId && isUUID(body.id)) data.id = body.id

  return data
}

type ContactPersonRow = Record<string, any>

/**
 * Database row → app shape. Restores the names the UI reads and derives the
 * fields that have no column of their own.
 */
export function contactPersonFromDb(row: ContactPersonRow): Record<string, unknown> {
  const firstName = row.firstName ?? ''
  const lastName = row.lastName ?? ''
  const companyName = row.client?.companyName || row.client?.name || undefined

  return {
    id: row.id,
    clientId: row.clientId,
    // The app treats companyId as an alias for clientId; deriving it keeps
    // both spellings working without a second column to drift.
    companyId: row.clientId,
    companyName,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    jobTitle: row.position ?? undefined,
    // Emitted under both names. jobTitle is what the app reads; `position` is
    // the column name and some callers still read it. Keeping both costs one
    // string and removes a whole class of "which spelling is it here" bug.
    position: row.position ?? undefined,
    department: row.department ?? undefined,
    email: row.email ?? '',
    phone: row.phone ?? '',
    mobile: row.mobile ?? undefined,
    linkedIn: row.linkedIn ?? undefined,
    isPrimary: row.isPrimary === true,
    isDecisionMaker: row.isDecisionMaker === true,
    isTechnicalContact: row.isTechnicalContact === true,
    isBillingContact: row.isBillingContact === true,
    preferredChannel: row.preferredChannel ?? undefined,
    notes: row.notes ?? undefined,
    createdDate: row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : (row.createdAt ?? undefined),
  }
}

/** Fields selected for the broadcast — never the whole nested client row. */
export const CONTACT_PERSON_SELECT = {
  id: true,
  clientId: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  mobile: true,
  position: true,
  department: true,
  linkedIn: true,
  isPrimary: true,
  isDecisionMaker: true,
  isTechnicalContact: true,
  isBillingContact: true,
  preferredChannel: true,
  notes: true,
  createdAt: true,
  client: { select: { id: true, name: true, companyName: true } },
} as const
