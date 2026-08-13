import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { pickRoundRobinOwner } from '@/lib/crm/sales-inbox-leads'
import { LEAD_ASSIGNEE_ROLES } from '@/lib/crm/lead-assignees'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { buildNotifyRows } from '@/lib/in-app-notifications'
import { notifyInboundLeadCreated } from '@/lib/crm/sales-inbox-notifications'

const WRITE_ROLES = ['director', 'admin_officer', 'sales_rep', 'sales']

/**
 * Email Review queue: inbound audit rows + needs_review leads.
 */
export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()

    const status = (req.nextUrl.searchParams.get('status') || 'REVIEW_REQUIRED').trim()
    const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit') || 50) || 50))

    let inbound: unknown[] = []
    try {
      inbound = await prisma.salesInboundEmail.findMany({
        where: status === 'all' ? undefined : { processingStatus: status },
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
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

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
      let ownerId = body.ownerId || lead.ownerId || null
      if (!ownerId) {
        const reps = await prisma.user.findMany({
          where: { isActive: true, role: { in: [...LEAD_ASSIGNEE_ROLES] } },
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
          const owner = await prisma.user.findUnique({
            where: { id: ownerId },
            select: { email: true, username: true },
          })
          const state = await loadAppState(['deed_notifications'])
          const existing = Array.isArray(state.deed_notifications)
            ? state.deed_notifications as import('@/lib/in-app-notifications').AppNotification[]
            : []
          const { next } = buildNotifyRows(
            existing,
            {
              recipients: [ownerId],
              type: 'system',
              title: 'Inbound lead accepted',
              body: `${updated.name}${updated.companyName ? ` · ${updated.companyName}` : ''}`,
              module: 'crm',
              path: `/crm?crmTab=leads&leadId=${updated.id}`,
              icon: '📧',
              entityKey: `lead:${updated.id}`,
              excludeUserId: session.id,
            },
            () => randomUUID(),
          )
          await saveStoreKeys({ deed_notifications: JSON.stringify(next.slice(0, 500)) })
          await notifyInboundLeadCreated({
            leadId: updated.id,
            leadName: updated.name,
            companyName: updated.companyName,
            leadEmail: updated.email,
            subject: updated.emailSubject,
            ownerId,
            ownerEmail: owner?.email || null,
            ownerName: owner?.username || null,
          })
        } catch { /* notify best-effort */ }
      }

      return NextResponse.json({ ok: true, lead: updated })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  })
}
