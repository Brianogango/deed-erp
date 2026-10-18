/**
 * A lead's contact log. Before it existed a lead had nowhere to record a
 * call or an email and no date to come back to it, so nothing reminded
 * anyone and leads went cold between arriving and being converted.
 */

export const LEAD_ACTIVITY_TYPES = ['call', 'email', 'whatsapp', 'meeting', 'note'] as const
export type LeadActivityType = (typeof LEAD_ACTIVITY_TYPES)[number]

export type LeadActivity = {
  id: string
  type: LeadActivityType
  note: string
  at: string
  byId: string
  byName: string
  nextFollowUpAt?: string | null
}

/** Contact (not a note) moves a new lead on to "contacted". */
const CONTACT_TYPES: ReadonlySet<LeadActivityType> = new Set(['call', 'email', 'whatsapp', 'meeting'])

export function leadActivityList(raw: unknown): LeadActivity[] {
  return Array.isArray(raw) ? (raw as LeadActivity[]).filter(a => a && typeof a === 'object' && a.id) : []
}

export function appendLeadActivity(
  lead: { stage: string; activity?: unknown },
  entry: { type: LeadActivityType; note: string; byId: string; byName: string; nextFollowUpAt?: string | null },
  now = new Date(),
): { activity: LeadActivity[]; stage?: string; lastContactedAt?: Date; nextFollowUpAt: Date | null } {
  const at = now.toISOString()
  const followUp = entry.nextFollowUpAt ? new Date(entry.nextFollowUpAt) : null
  const record: LeadActivity = {
    id: `${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    type: entry.type,
    note: entry.note.slice(0, 4000),
    at,
    byId: entry.byId,
    byName: entry.byName,
    nextFollowUpAt: followUp && !Number.isNaN(followUp.getTime()) ? followUp.toISOString() : null,
  }
  const isContact = CONTACT_TYPES.has(entry.type)
  return {
    activity: [record, ...leadActivityList(lead.activity)].slice(0, 200),
    ...(isContact && ['new', 'needs_review'].includes(lead.stage) ? { stage: 'contacted' } : {}),
    ...(isContact ? { lastContactedAt: now } : {}),
    // Logging something without a new date clears the reminder: it was handled.
    nextFollowUpAt: record.nextFollowUpAt ? new Date(record.nextFollowUpAt) : null,
  }
}
