import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { pickRoundRobinOwner } from '@/lib/crm/sales-inbox-leads'
import { LEAD_ASSIGNEE_ROLES } from '@/lib/crm/lead-assignees'
import { storedRoleNames } from '@/lib/auth/authorization'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { publishNotificationEvent } from '@/lib/notifications/service'
import { canAssignLead, canEditLead, leadListWhere, leadRole } from '@/lib/crm/lead-access'

const WRITE_ROLES = ['director', 'admin_officer', 'sales_rep', 'sales']

/**
 * Email Review queue: inbound audit rows + needs_review leads.
 */
export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    // CRM roles only (as GET /api/leads); reps see their own and unassigned.
    const role = leadRole(session.user.role)
    if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const repScope = leadListWhere(session.user.role, session.user.id)
    const isRep = role === 'sales_rep'

    const status = (req.nextUrl.searchParams.get('status') || 'REVIEW_REQUIRED').trim()
    const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit') || 50) || 50))

    let inbound: unknown[] = []
    try {
      inbound = await prisma.salesInboundEmail.findMany({
        where: {
          ...(status === 'all' ? {} : { processingStatus: status }),
          ...(isRep ? { OR: [{ leadId: null }, { lead: { ownerId: null } }, { lead: { ownerId: session.user.id } }] } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          lead: {
            select: {
              id: true,
              name: true,
              stage: true,
              email: true,
              companyName: true,
              ownerId: true,
              emailSubject: true,
              emailSnippet: true,
              notes: true,
            },
          },
        },
      })
    } catch {
      inbound = []
    }

    const reviewLeads = await prisma.lead.findMany({
      where: {
        stage: 'needs_review',
        OR: [
          { source: 'inbound_email' },
          { inboundMessageId: { not: null } },
        ],
        ...(isRep ? { AND: [repScope] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        owner: { select: { id: true, username: true, email: true } },
      },
    })

    return NextResponse.json({
      inbound,
      reviewLeads,
      statuses: [
        'REVIEW_REQUIRED',
        'LEAD_CREATED',
        'LINKED_EXISTING_LEAD',
        'FILTERED',
        'NON_SALES',
        'CLASSIFIED',
        'all',
      ],
    })
  })
}

/**
 * Review actions on a needs_review lead (and linked inbound row).
 * body: { leadId, action: 'accept'|'reject'|'non_sales', ownerId? }
 */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await requireRole(WRITE_ROLES)
    const body = await req.json() as {
      leadId?: string
      action?: string
      ownerId?: string | null
    }
    if (!body.leadId || !body.action) {
      return NextResponse.json({ error: 'leadId and action required' }, { status: 400 })
    }

    const lead = await prisma.lead.findUnique({ where: { id: body.leadId } })
    // Same rules as PUT /api/leads/[id]: only a lead the caller may edit, and
    // this queue acts only on leads still waiting for review.
    if (!lead || !canEditLead(session.role, session.id, lead)) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    if (lead.stage !== 'needs_review') {
      return NextResponse.json({ error: 'This lead has already been reviewed' }, { status: 409 })
    }

    if (body.action === 'reject' || body.action === 'non_sales') {
      const updated = await prisma.lead.update({
        where: { id: lead.id },
        data: {
          stage: 'lost',
          notes: `${lead.notes || ''}\n\n[email-review] ${body.action} by ${session.username} @ ${new Date().toISOString()}`.slice(0, 20000),
        },
      })
      try {
        await prisma.salesInboundEmail.updateMany({
          where: { leadId: lead.id },
          data: {
            processingStatus: body.action === 'non_sales' ? 'NON_SALES' : 'REJECTED',
            decision: body.action === 'non_sales' ? 'NON_SALES' : 'REJECTED',
            processingReason: `HUMAN_${body.action.toUpperCase()}`,
          },
        })
      } catch { /* table may be missing */ }
      return NextResponse.json({ ok: true, lead: updated })
    }

    if (body.action === 'accept') {
      // Only managers choose the owner; a rep can only pick the lead up.
      const requestedOwner = body.ownerId && (canAssignLead(session.role) || body.ownerId === session.id) ? body.ownerId : null
      let ownerId = requestedOwner || lead.ownerId || null
      if (!ownerId) {
        const reps = await prisma.user.findMany({
          where: { isActive: true, role: { in: storedRoleNames(LEAD_ASSIGNEE_ROLES) as any } },
          select: { id: true },
          orderBy: { username: 'asc' },
        })
        const state = await loadAppState(['deed_salesLeadRoundRobin'])
        const last = state.deed_salesLeadRoundRobin && typeof state.deed_salesLeadRoundRobin === 'object'
          ? (state.deed_salesLeadRoundRobin as { lastOwnerId?: string }).lastOwnerId || null
          : null
        ownerId = pickRoundRobinOwner(reps.map(r => r.id), last)
        if (ownerId) {
          try {
            await saveStoreKeys({
              deed_salesLeadRoundRobin: JSON.stringify({
                lastOwnerId: ownerId,
                updatedAt: new Date().toISOString(),
              }),
            })
          } catch { /* ignore */ }
        }
      }

      const updated = await prisma.lead.update({
        where: { id: lead.id },
        data: {
          stage: 'new',
          ownerId,
          notes: `${lead.notes || ''}\n\n[email-review] accepted by ${session.username} @ ${new Date().toISOString()}`.slice(0, 20000),
        },
      })

      try {
        await prisma.salesInboundEmail.updateMany({
          where: { leadId: lead.id },
          data: {
            processingStatus: 'LEAD_CREATED',
            decision: 'LEAD_CREATED',
            processingReason: 'HUMAN_ACCEPT',
          },
        })
      } catch { /* ignore */ }

      if (ownerId) {
        try {
          await publishNotificationEvent({
            eventType: 'crm.lead.created',
            entityType: 'lead',
            entityId: updated.id,
            actorUserId: session.id,
            userIds: [ownerId],
            title: 'Inbound lead accepted',
            body: `${updated.name}${updated.companyName ? ` · ${updated.companyName}` : ''}`,
            actionUrl: `/crm?crmTab=leads&leadId=${updated.id}`,
            metadata: {
              leadEmail: updated.email,
              subject: updated.emailSubject,
            },
            idempotencyKey: `crm-lead-accepted:${updated.id}:${ownerId}`,
          })
        } catch { /* notification outbox is best-effort after lead commit */ }
      }

      return NextResponse.json({ ok: true, lead: updated })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  })
}
