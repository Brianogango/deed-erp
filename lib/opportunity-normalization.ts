// The opportunities API persists only the Prisma columns (assignedToId, value,
// closeDate, stage …), while the CRM UI works with the richer client shape
// (ownerId, expectedValue, expectedCloseDate …). Rows loaded from the server —
// on boot or via the store SSE broadcast — must therefore be normalized before
// the pipeline can display and filter them. Without this mapping, opportunities
// created by reps never matched the owner filters (ownerId was undefined) and
// looked like they "never loaded" for directors.

const CLIENT_STAGES = new Set([
  'prospecting', 'qualification', 'proposal', 'negotiation',
  'closed_won', 'closed_lost', 'on_hold',
])

const STAGE_ALIASES: Record<string, string> = {
  new: 'prospecting',
  lead: 'prospecting',
  qualified: 'qualification',
  won: 'closed_won',
  lost: 'closed_lost',
}

const toDayString = (value: unknown): string | undefined => {
  if (!value) return undefined
  const d = new Date(value as string)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10)
}

export function normalizeOpportunityForClient(raw: any) {
  if (!raw || typeof raw !== 'object') return raw

  const rawStage = String(raw.stage ?? '')
  const stage = CLIENT_STAGES.has(rawStage)
    ? rawStage
    : (STAGE_ALIASES[rawStage] ?? 'prospecting')

  const ownerId = raw.ownerId ?? raw.assignedToId ?? raw.createdById ?? undefined

  return {
    ...raw,
    ref: raw.ref ?? `OPP-${String(raw.id ?? '').slice(0, 8).toUpperCase()}`,
    companyId: raw.companyId ?? raw.clientId ?? undefined,
    companyName: raw.companyName ?? raw.client?.name ?? undefined,
    ownerId,
    ownerName: raw.ownerName ?? raw.assignedTo?.name ?? undefined,
    assignedToId: raw.assignedToId ?? ownerId,
    stage,
    probability: Number(raw.probability ?? 0) || 0,
    expectedValue: Number(raw.expectedValue ?? raw.value ?? 0) || 0,
    expectedCloseDate: raw.expectedCloseDate ?? toDayString(raw.closeDate),
    createdAt: raw.createdAt ?? new Date().toISOString(),
    createdDate: raw.createdDate ?? toDayString(raw.createdAt),
  }
}

export function normalizeOpportunitiesForClient(rawOpportunities: any[]) {
  return Array.isArray(rawOpportunities)
    ? rawOpportunities.map(normalizeOpportunityForClient)
    : []
}
