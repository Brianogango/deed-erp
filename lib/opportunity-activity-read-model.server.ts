import 'server-only'

import prisma from '@/lib/prisma'
import type { OpportunityActivity, Prisma } from '@prisma/client'
import { mergeScreenExtras, readScreenExtras } from '@/lib/screen-extras'

/**
 * Opportunity activities as the screens use them, read from
 * opportunity_activities (the deed_oppActivities copy is frozen). The fields
 * the table has no column for are kept in screen_extras.
 */

export const OPP_ACTIVITY_EXTRA_KEYS = ['subject', 'outcome', 'status', 'completedDate', 'createdByName', 'createdDate'] as const

type Row = Record<string, any>

type DealOwners = { opportunity?: { assignedToId: string | null; createdById: string } | null }

export function toScreenActivity(a: OpportunityActivity & DealOwners): Row {
  return {
    id: a.id,
    opportunityId: a.opportunityId,
    type: a.type,
    description: a.description ?? undefined,
    scheduledAt: a.scheduledAt?.toISOString(),
    createdById: a.createdById,
    createdAt: a.createdAt.toISOString(),
    // Who owns the deal, so a rep's copy can be cut to their own deals.
    ...(a.opportunity ? { dealAssignedToId: a.opportunity.assignedToId, dealCreatedById: a.opportunity.createdById } : {}),
    ...readScreenExtras(a.screenExtras, OPP_ACTIVITY_EXTRA_KEYS),
  }
}

const DEAL_OWNERS = { opportunity: { select: { assignedToId: true, createdById: true } } } as const

export function activityExtras(body: unknown, stored?: unknown): Prisma.InputJsonObject | undefined {
  return mergeScreenExtras(stored, body, OPP_ACTIVITY_EXTRA_KEYS) ?? undefined
}

export async function loadScreenActivities(screenCopy: unknown): Promise<Row[]> {
  const rows = await prisma.opportunityActivity.findMany({ orderBy: { createdAt: 'desc' }, include: DEAL_OWNERS })
  const out = rows.map(toScreenActivity)
  const ids = new Set(rows.map(r => r.id))
  for (const a of Array.isArray(screenCopy) ? screenCopy as Row[] : []) {
    if (a?.id && !ids.has(String(a.id))) out.push(a)
  }
  return out
}
