import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { saveStoreKeys } from '@/lib/server-store'
import { broadcastContacts, upsertContact } from '@/lib/contact-prisma'
import { clip, leadCustomerDisplayName, looksLikeEnquiryTitle, splitContactName } from '@/lib/crm/lead-convert'
import { findExistingClientForLead, findExistingContactPerson } from '@/lib/crm/lead-client-resolve'
import { normalizeOpportunitiesForClient } from '@/lib/opportunity-normalization'

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
    // Normalize so CRM owner filters see ownerId (Prisma only has assignedToId).
    void saveStoreKeys({ deed_opportunities: JSON.stringify(normalizeOpportunitiesForClient(all)) })
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

    // Reuse an existing customer whenever email, phone, company, or corporate
    // domain already matches. Creating a Client per inbound RFQ is what filled
    // Contacts with duplicates. Do not overwrite the matched record's name.
    const existingClient = await findExistingClientForLead(prisma, lead)
    let clientId = existingClient?.id || null
    let clientName = existingClient?.name || leadCustomerDisplayName(lead)
    let createdClient = false

    if (!clientId) {
      const contactResult = await upsertContact(prisma, {
        name: clip(clientName, 200) || 'Customer',
        companyName: clip(lead.companyName, 200) || undefined,
        email: clip(lead.email, 150) || undefined,
        phone: clip(lead.phone, 20) || undefined,
        type: lead.companyName ? 'company' : 'individual',
        isCustomer: true,
        notes: clip(lead.notes, 2000) || undefined,
      }, { matchByName: false })
      if (typeof contactResult === 'string') {
        return NextResponse.json({ error: contactResult }, { status: 422 })
      }
      clientId = contactResult.contact.id
      clientName = contactResult.contact.name || clientName
      createdClient = contactResult.created
    } else if (lead.phone && !existingClient?.phone) {
      const phone = clip(lead.phone, 20)
      if (phone) {
        await prisma.client.update({
          where: { id: clientId },
          data: { phone },
        }).catch(() => {})
      }
    }

    if (!clientId) {
      return NextResponse.json({ error: 'Could not resolve a customer for this lead' }, { status: 422 })
    }

    let contactPersonId: string | null = null
    if (body.createContact !== false && clientId) {
      const already = await findExistingContactPerson(prisma, {
        clientId,
        email: lead.email,
        phone: lead.phone,
      })
      if (already) {
        contactPersonId = already.id
      } else {
        const { firstName, lastName } = splitContactName(
          looksLikeEnquiryTitle(lead.name) ? (lead.email || lead.companyName || lead.name) : lead.name,
        )
        const contact = await prisma.contactPerson.create({
          data: {
            clientId,
            firstName,
            lastName,
            email: clip(lead.email, 150),
            phone: clip(lead.phone, 20),
            position: 'Contact',
          },
        })
        contactPersonId = contact.id
      }
    }

    const opportunity = await prisma.opportunity.create({
      data: {
        clientId,
        name: clip(
          lead.companyName ? `${lead.companyName} — ${lead.name}` : lead.name,
          200,
        ) || lead.name.slice(0, 200),
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

    // Keep CRM pipeline + Sales contacts in sync without a full page reload.
    void broadcastOpportunities()
    void broadcastContacts(prisma)

    return NextResponse.json({
      lead: updatedLead,
      opportunity,
      contactPersonId,
      clientId,
      clientName,
      createdClient,
    })
  })
}
