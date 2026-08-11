import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { saveStoreKeys } from '@/lib/server-store'

const LEAD_INCLUDE = {
  owner: { select: { id: true, username: true, email: true } },
  client: true,
  opportunity: true,
} as const

const WRITE_ROLES = ['director', 'admin_officer', 'sales_rep', 'finance_officer']

async function broadcastOpportunities() {
  try {
    const all = await prisma.opportunity.findMany({
      include: { client: true, assignedTo: true, activities: true },
      orderBy: { createdAt: 'desc' },
    })
    void saveStoreKeys({ deed_opportunities: JSON.stringify(all) })
  } catch { /* best-effort SSE sync */ }
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const lead = await prisma.lead.findUnique({
      where: { id: params.id },
      include: LEAD_INCLUDE,
    })
    if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(lead)
  })
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!WRITE_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const body = await request.json()
    const data: Record<string, unknown> = {}
    if (body.name !== undefined) data.name = String(body.name).trim()
    if (body.companyName !== undefined) data.companyName = body.companyName?.trim() || null
    if (body.email !== undefined) data.email = body.email?.trim() || null
    if (body.phone !== undefined) data.phone = body.phone?.trim() || null
    if (body.source !== undefined) data.source = body.source?.trim() || null
    if (body.stage !== undefined) data.stage = body.stage
    if (body.ownerId !== undefined) data.ownerId = body.ownerId ? body.ownerId : null
    if (body.clientId !== undefined) data.clientId = body.clientId
    if (body.notes !== undefined) data.notes = body.notes

    const lead = await prisma.lead.update({
      where: { id: params.id },
      data,
      include: LEAD_INCLUDE,
    })
    return NextResponse.json(lead)
  })
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!WRITE_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    await prisma.lead.delete({ where: { id: params.id } })
    return NextResponse.json({ ok: true })
  })
}

/** POST { action: 'convert', createContact?: boolean, expectedValue?: number } */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!WRITE_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    if (body.action !== 'convert') {
      return NextResponse.json({ error: 'Unsupported action — use { action: "convert" }' }, { status: 400 })
    }

    const lead = await prisma.lead.findUnique({ where: { id: params.id } })
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    if (lead.stage === 'converted') {
      return NextResponse.json({ error: 'Lead already converted' }, { status: 409 })
    }

    let clientId = lead.clientId
    if (!clientId && lead.companyName) {
      const client = await prisma.client.create({
        data: {
          clientNumber: `CLT-${Date.now().toString().slice(-8)}`,
          clientType: 'company',
          name: lead.companyName,
          email: lead.email,
          phone: lead.phone,
        },
      })
      clientId = client.id
    }
    if (!clientId) {
      const client = await prisma.client.create({
        data: {
          clientNumber: `CLT-${Date.now().toString().slice(-8)}`,
          clientType: 'individual',
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
        },
      })
      clientId = client.id
    }

    let contactPersonId: string | null = null
    if (body.createContact !== false && clientId) {
      const parts = lead.name.trim().split(/\s+/)
      const firstName = parts[0] || lead.name
      const lastName = parts.slice(1).join(' ') || '—'
      const contact = await prisma.contactPerson.create({
        data: {
          clientId,
          firstName,
          lastName,
          email: lead.email,
          phone: lead.phone,
          position: 'Contact',
        },
      })
      contactPersonId = contact.id
    }

    const opportunity = await prisma.opportunity.create({
      data: {
        clientId,
        name: lead.companyName ? `${lead.companyName} — ${lead.name}` : lead.name,
        description: lead.notes,
        stage: 'qualification',
        probability: 20,
        value: Number(body.expectedValue ?? 0),
        assignedToId: lead.ownerId ?? session.user.id,
        createdById: session.user.id,
      },
      include: { client: true, assignedTo: true },
    })

    const updatedLead = await prisma.lead.update({
      where: { id: lead.id },
      data: {
        stage: 'converted',
        clientId,
        opportunityId: opportunity.id,
      },
      include: LEAD_INCLUDE,
    })

    // Push the new opportunity into the CRM blob so the pipeline updates without a full reload.
    void broadcastOpportunities()

    return NextResponse.json({
      lead: updatedLead,
      opportunity,
      contactPersonId,
      clientId,
    })
  })
}
