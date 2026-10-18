import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { broadcastContacts, upsertContact } from '@/lib/contact-prisma'
import { clip, leadCustomerDisplayName, looksLikeEnquiryTitle, splitContactName } from '@/lib/crm/lead-convert'
import { findExistingClientForLead, findExistingContactPerson } from '@/lib/crm/lead-client-resolve'
import { normalizeOpportunityForClient } from '@/lib/opportunity-normalization'
import { broadcastOpportunities, opportunityRef, OPPORTUNITY_INCLUDE } from '@/lib/opportunity-server'
import { notifyLeadAssigned } from '@/lib/crm/lead-notify'
import { appendLeadActivity, LEAD_ACTIVITY_TYPES, type LeadActivityType } from '@/lib/crm/lead-activity'

const LEAD_INCLUDE = {
  owner: { select: { id: true, username: true, email: true } },
  client: true,
  opportunity: true,
} as const

const WRITE_ROLES = ['director', 'admin_officer', 'sales_rep', 'finance_officer']

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const lead = await prisma.lead.findUnique({
      where: { id: resolvedParams.id },
      include: LEAD_INCLUDE,
    })
    if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(lead)
  })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
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
    if (body.nextFollowUpAt !== undefined) data.nextFollowUpAt = body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null

    const before = data.ownerId !== undefined
      ? await prisma.lead.findUnique({ where: { id: resolvedParams.id }, select: { ownerId: true } })
      : null
    const lead = await prisma.lead.update({
      where: { id: resolvedParams.id },
      data,
      include: LEAD_INCLUDE,
    })
    if (before && before.ownerId !== lead.ownerId) await notifyLeadAssigned(lead, session.user.id)
    return NextResponse.json(lead)
  })
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!WRITE_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    await prisma.lead.delete({ where: { id: resolvedParams.id } })
    return NextResponse.json({ ok: true })
  })
}

/** POST { action: 'convert', createContact?: boolean, expectedValue?: number } */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!WRITE_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    if (body.action === 'log') {
      // A call, email, WhatsApp, meeting or note on the lead, and when to follow up next.
      const type = String(body.type || '') as LeadActivityType
      if (!LEAD_ACTIVITY_TYPES.includes(type)) {
        return NextResponse.json({ error: 'Choose what kind of contact this was' }, { status: 400 })
      }
      const note = String(body.note || '').trim()
      if (!note) return NextResponse.json({ error: 'Write what happened' }, { status: 400 })
      const current = await prisma.lead.findUnique({ where: { id: resolvedParams.id } })
      if (!current) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
      const next = appendLeadActivity(current, {
        type,
        note,
        byId: session.user.id,
        byName: session.user.name || session.user.username || 'Staff',
        nextFollowUpAt: body.nextFollowUpAt ? String(body.nextFollowUpAt) : null,
      })
      const lead = await prisma.lead.update({
        where: { id: current.id },
        data: next,
        include: LEAD_INCLUDE,
      })
      return NextResponse.json(lead)
    }
    if (body.action !== 'convert') {
      return NextResponse.json({ error: 'Unsupported action — use { action: "convert" } or { action: "log" }' }, { status: 400 })
    }

    const lead = await prisma.lead.findUnique({ where: { id: resolvedParams.id } })
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
    let contactPersonName: string | null = null
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
        contactPersonName = `${firstName} ${lastName === '—' ? '' : lastName}`.trim()
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
        // Who to talk to and where the deal came from travel with it.
        screenExtras: {
          ref: await opportunityRef(null),
          companyName: clientName,
          contactPersonId,
          contactPersonName: contactPersonName ?? lead.name,
          contactEmail: lead.email,
          contactPhone: lead.phone,
          leadSource: lead.source === 'inbound_email' ? 'website' : (lead.source || undefined),
          leadId: lead.id,
          customerNeeds: lead.emailSnippet || lead.notes || undefined,
        },
      },
      include: OPPORTUNITY_INCLUDE,
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
      opportunity: normalizeOpportunityForClient(opportunity),
      contactPersonId,
      clientId,
      clientName,
      createdClient,
    })
  })
}
