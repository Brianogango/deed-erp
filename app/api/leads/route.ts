import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { pickRoundRobinOwner, pickStickyOwnerFromPriorLeads } from '@/lib/crm/sales-inbox-leads'
import { LEAD_ASSIGNEE_ROLES } from '@/lib/crm/lead-assignees'
import { storedRoleNames } from '@/lib/auth/authorization'
import { notifyLeadAssigned } from '@/lib/crm/lead-notify'
import { canAssignLead, leadListWhere, leadRole, phoneKey } from '@/lib/crm/lead-access'

const LEAD_INCLUDE = {
  owner: { select: { id: true, username: true, email: true } },
  client: true,
  opportunity: true,
} as const

const WRITE_ROLES = ['director', 'admin_officer', 'sales_rep', 'finance_officer']

export async function GET() {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!leadRole(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const leads = await prisma.lead.findMany({
      where: leadListWhere(session.user.role, session.user.id),
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
    const name = String(body.name || '').trim()
    const email = String(body.email || '').trim().toLowerCase()
    const phone = String(body.phone || '').trim()
    if (!name) return NextResponse.json({ error: 'Give the lead a name' }, { status: 400 })
    if (!email && !phone) return NextResponse.json({ error: 'Add a phone number or an email, or nobody can follow it up' }, { status: 400 })
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: 'Check the email address' }, { status: 400 })

    // The same person arriving twice (a call, then an email) used to become two
    // leads worked by two reps. Stop and show the open one unless told to go on.
    if (body.allowDuplicate !== true) {
      const key = phoneKey(phone)
      const open = await prisma.lead.findMany({
        where: {
          stage: { notIn: ['converted', 'lost'] },
          OR: [
            ...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : []),
            ...(key ? [{ phone: { endsWith: key.slice(-6) } }] : []),
          ],
        },
        select: { id: true, name: true, companyName: true, email: true, phone: true, ownerId: true, owner: { select: { username: true } } },
        take: 20,
      })
      const matches = open.filter(l => (email && l.email?.toLowerCase() === email) || (key && phoneKey(l.phone) === key))
      if (matches.length) {
        return NextResponse.json({
          error: 'This person is already an open lead',
          duplicates: matches.map(m => ({ id: m.id, name: m.name, companyName: m.companyName, owner: m.owner?.username ?? null })),
        }, { status: 409 })
      }
    }

    // Reps add leads for themselves; managers may assign.
    let ownerId = canAssignLead(session.user.role) ? (body.ownerId ?? session.user.id) : session.user.id

    // When Auto-assign Leads is on and the client did not pick an owner,
    // sticky-match same org/domain first, then round-robin.
    if (!body.ownerId && canAssignLead(session.user.role)) {
      const state = await loadAppState(['deed_systemSettings', 'deed_salesLeadRoundRobin'])
      const auto = state.deed_systemSettings && typeof state.deed_systemSettings === 'object'
        ? Boolean((state.deed_systemSettings as { crmAutoAssignLeads?: boolean }).crmAutoAssignLeads)
        : false
      if (auto) {
        const reps = await prisma.user.findMany({
          where: { isActive: true, role: { in: storedRoleNames(LEAD_ASSIGNEE_ROLES) as any } },
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
        name: name.slice(0, 200),
        companyName: body.companyName?.trim()?.slice(0, 200) || null,
        email: email || null,
        phone: phone.slice(0, 40) || null,
        source: body.source?.trim() || null,
        stage: body.stage ?? 'new',
        ownerId,
        clientId: body.clientId ?? null,
        notes: body.notes ?? null,
        // A new lead is due for first contact the same day.
        nextFollowUpAt: body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : new Date(),
      },
      include: LEAD_INCLUDE,
    })
    await notifyLeadAssigned(lead, session.user.id)
    return NextResponse.json(lead, { status: 201 })
  })
}
