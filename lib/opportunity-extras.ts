/**
 * The deal fields the opportunities table has no column for. They live in
 * `screen_extras`; before it existed every save dropped them, so after a
 * reload a deal had lost its number, contact, source, won value, lost reason
 * and linked quotations.
 */
export const OPPORTUNITY_EXTRA_KEYS = [
  'ref',
  'companyName',
  'contactPersonId',
  'contactPersonName',
  'contactEmail',
  'contactPhone',
  'leadSource',
  'leadScore',
  'leadId',
  'customerNeeds',
  'competitorInfo',
  'notes',
  'tags',
  'quoteIds',
  'saleOrderIds',
  'actualValue',
  'actualCloseDate',
  'lostReason',
  'lostToCompetitor',
  'wonReason',
  'lastActivityDate',
] as const

type Extras = Partial<Record<(typeof OPPORTUNITY_EXTRA_KEYS)[number], unknown>>

/** The extra fields present in a request body, merged over what is stored. */
export function opportunityExtras(body: Record<string, unknown> | null | undefined, stored?: unknown): Extras {
  const base: Extras = stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...(stored as Extras) } : {}
  if (!body || typeof body !== 'object') return base
  for (const key of OPPORTUNITY_EXTRA_KEYS) {
    if (body[key] !== undefined) base[key] = body[key]
  }
  return base
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The browser's own id for a new deal, so its later edits and activities find the row. */
export function clientOpportunityId(body: Record<string, unknown> | null | undefined): string | undefined {
  const id = body?.id
  return typeof id === 'string' && UUID.test(id) ? id : undefined
}
