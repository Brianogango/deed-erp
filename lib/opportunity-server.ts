import 'server-only'
import prisma from '@/lib/prisma'
import { saveStoreKeys } from '@/lib/server-store'
import { getNextDocNumber } from '@/lib/doc-ref-counter'
import { normalizeOpportunitiesForClient } from '@/lib/opportunity-normalization'

export const OPPORTUNITY_INCLUDE = { client: true, assignedTo: true, activities: true } as const

/** Push the full pipeline to open tabs (normalized: owner, stage and the screen fields). */
export async function broadcastOpportunities() {
  try {
    const all = await prisma.opportunity.findMany({ include: OPPORTUNITY_INCLUDE, orderBy: { createdAt: 'desc' } })
    await saveStoreKeys({ deed_opportunities: JSON.stringify(normalizeOpportunitiesForClient(all)) })
  } catch { /* best-effort SSE sync */ }
}

/** A deal number from the server counter, unless the deal already has a real one. */
export async function opportunityRef(current: unknown): Promise<string> {
  const ref = typeof current === 'string' ? current.trim() : ''
  if (/^OPP\/\d+$/.test(ref)) return ref
  return getNextDocNumber('opportunity')
}
