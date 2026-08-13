import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { pickRoundRobinOwner, pickStickyOwnerFromPriorLeads } from '@/lib/crm/sales-inbox-leads'
import { LEAD_ASSIGNEE_ROLES } from '@/lib/crm/lead-assignees'

const LEAD_INCLUDE = {
  owner: { select: { id: true, username: true, email: true } },
  client: true,
  opportunity: true,
} as const

const WRITE_ROLES = ['director', 'admin_officer', 'sales_rep', 'finance_officer']

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const leads = await prisma.lead.findMany({
      include: LEAD_INCLUDE,
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(leads)
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!WRITE_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const body = await request.json()
    let ownerId = body.ownerId ?? session.user.id

    // When Auto-assign Leads is on and the client did not pick an owner,
    // sticky-match same org/domain first, then round-robin.
    if (!body.ownerId) {
      const state = await loadAppState(['deed_systemSettings', 'deed_salesLeadRoundRobin'])
      const auto = state.deed_systemSettings && typeof state.deed_systemSettings === 'object'
        ? Boolean((state.deed_systemSettings as { crmAutoAssignLeads?: boolean }).crmAutoAssignLeads)
        : false
      if (auto) {
        const reps = await prisma.user.findMany({
          where: { isActive: true, role: { in: [...LEAD_ASSIGNEE_ROLES] } },
          select: { id: true },
          orderBy: { username: 'asc' },
        })
        const repIds = reps.map(r => r.id)
        const prior = await prisma.lead.findMany({
          where: { ownerId: { not: null } },
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: { ownerId: true, email: true, companyName: true },
        })
        const sticky = pickStickyOwnerFromPriorLeads(
          prior,
          { email: body.email, companyName: body.companyName },
          repIds,
        )
        if (sticky) {
          ownerId = sticky
        } else {
          const last = state.deed_salesLeadRoundRobin && typeof state.deed_salesLeadRoundRobin === 'object'
            ? String((state.deed_salesLeadRoundRobin as { lastOwnerId?: string }).lastOwnerId || '')
            : ''
          const next = pickRoundRobinOwner(repIds, last || null)
          if (next) {
            ownerId = next
            await saveStoreKeys({
              deed_salesLeadRoundRobin: JSON.stringify({ lastOwnerId: next, updatedAt: new Date().toISOString() }),
            })
          }
        }
      }
    }

    const lead = await prisma.lead.create({
      data: {
        name: String(body.name || '').trim(),
        companyName: body.companyName?.trim() || null,
        email: body.email?.trim() || null,
        phone: body.phone?.trim() || null,
        source: body.source?.trim() || null,
        stage: body.stage ?? 'new',
        ownerId,
        clientId: body.clientId ?? null,
        notes: body.notes ?? null,
      },
      include: LEAD_INCLUDE,
    })
    return NextResponse.json(lead, { status: 201 })
  })
}
