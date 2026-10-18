import { NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { canAssignLead, leadRole, phoneKey } from '@/lib/crm/lead-access'
import { parseLeadRows } from '@/lib/crm/lead-import'
import { notifyLeadAssigned } from '@/lib/crm/lead-notify'

export const dynamic = 'force-dynamic'

const Body = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
  source: z.string().trim().min(1).max(50),
  ownerId: z.string().uuid().nullable().optional(),
}).strict()

/**
 * POST /api/leads/import — create leads from spreadsheet rows.
 *
 * Every row is checked again here (name, phone or email, email format).
 * Anyone who is already an open lead (same email or phone) is skipped and
 * listed, so an imported list never doubles up on leads already being
 * worked. Imported leads are due for first contact today.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!leadRole(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const parsed = Body.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Send between 1 and 1,000 rows and a source' }, { status: 400 })
    const { rows, source } = parsed.data
    // Reps import for themselves; managers choose an owner or leave them unassigned.
    const ownerId = canAssignLead(session.user.role) ? (parsed.data.ownerId ?? null) : session.user.id
    if (ownerId) {
      const owner = await prisma.user.findFirst({ where: { id: ownerId, isActive: true }, select: { id: true } })
      if (!owner) return NextResponse.json({ error: 'That owner is not an active user' }, { status: 400 })
    }

    const { leads, problems } = parseLeadRows(rows)

    const open = await prisma.lead.findMany({
      where: { stage: { notIn: ['converted', 'lost'] } },
      select: { name: true, email: true, phone: true },
    })
    const openEmails = new Set(open.map(l => l.email?.toLowerCase()).filter(Boolean) as string[])
    const openPhones = new Set(open.map(l => phoneKey(l.phone)).filter(Boolean) as string[])
    const skipped: string[] = []
    const fresh = leads.filter(l => {
      const dup = (l.email && openEmails.has(l.email)) || (phoneKey(l.phone) && openPhones.has(phoneKey(l.phone)!))
      if (dup) skipped.push(l.name)
      return !dup
    })

    const now = new Date()
    const created = fresh.length
      ? await prisma.$transaction(fresh.map(l => prisma.lead.create({
          data: {
            name: l.name,
            companyName: l.companyName || null,
            email: l.email || null,
            phone: l.phone || null,
            notes: l.notes || null,
            source,
            stage: 'new',
            ownerId,
            nextFollowUpAt: now,
          },
          select: { id: true, name: true, companyName: true, ownerId: true },
        })))
      : []

    if (ownerId && ownerId !== session.user.id && created.length) {
      // One notice for the batch rather than one per row.
      await notifyLeadAssigned({
        id: created[0].id,
        name: created.length === 1 ? created[0].name : `${created.length} imported leads`,
        companyName: created.length === 1 ? created[0].companyName : null,
        ownerId,
      }, session.user.id)
    }

    return NextResponse.json({ created: created.length, skippedExisting: skipped, problems })
  })
}
