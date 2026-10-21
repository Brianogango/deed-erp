import { NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { notifyStoreKeysChanged } from '@/lib/server-store'
import { pickMailbox, sendEmail } from '@/lib/integrations/email'
import { appendLeadActivity } from '@/lib/crm/lead-activity'
import { crmEmailHtml, crmEmailText } from '@/lib/crm/crm-email'
import { canEditLead } from '@/lib/crm/lead-access'
import { canAccessRecord } from '@/lib/auth/authorization'

export const dynamic = 'force-dynamic'

const WRITE_ROLES = ['director', 'admin_officer', 'sales_rep', 'finance_officer']

const emails = z.string().trim().min(3).max(500)
  .transform(s => s.split(/[,;\s]+/).map(e => e.trim()).filter(Boolean))
  .refine(list => list.length > 0 && list.length <= 10 && list.every(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)), 'Check the email address')

const Body = z.object({
  leadId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().optional(),
  to: emails,
  cc: z.string().trim().max(500).optional().transform(v => (v ? v.split(/[,;\s]+/).filter(Boolean) : [])),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20000),
  /** YYYY-MM-DD: when to chase this email if there is no answer. */
  nextFollowUpAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
}).refine(b => Boolean(b.leadId) !== Boolean(b.opportunityId), 'Send from one lead or one deal')

/**
 * POST /api/crm/email — email a lead or a deal's contact from the CRM.
 *
 * Sent through the sales mailbox with the rep's own name and work address
 * (no staff password needed, same as HR leave emails). Replies go to the rep
 * and to sales@, so the inbox picks them up on the same lead. Every email is
 * logged on the lead or deal, with an optional date to chase it.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!WRITE_ROLES.includes(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const parsed = Body.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid email' }, { status: 400 })
    }
    const b = parsed.data
    const repName = session.user.name || session.user.username || 'Deed Sales'
    const repEmail = String(session.user.email || '').trim()
    const sales = pickMailbox('sales')
    const replyTo = [repEmail, sales.from].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ')

    let inReplyTo: string | undefined
    const lead = b.leadId ? await prisma.lead.findUnique({ where: { id: b.leadId } }) : null
    if (b.leadId && !lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    const opp = b.opportunityId ? await prisma.opportunity.findUnique({ where: { id: b.opportunityId } }) : null
    if (b.opportunityId && !opp) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    if (lead && !canEditLead(session.user.role, session.user.id, lead)) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }
    if (opp && !canAccessRecord(session.user.role, 'opportunity', { ownerId: opp.createdById, assignedToId: opp.assignedToId }, session.user.id)) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }
    // Answering an inbound enquiry: thread under the customer's own message.
    if (lead?.inboundMessageId && lead.inboundMessageId.includes('@')) {
      inReplyTo = lead.inboundMessageId.startsWith('<') ? lead.inboundMessageId : `<${lead.inboundMessageId}>`
    }

    const result = await sendEmail({
      mailbox: 'sales',
      to: b.to,
      cc: b.cc.length ? b.cc : undefined,
      replyTo,
      senderName: repName,
      senderEmail: repEmail || undefined,
      subject: b.subject,
      html: crmEmailHtml(b.body, { name: repName, email: repEmail }),
      plain: true,
      text: crmEmailText(b.body, { name: repName, email: repEmail }),
      ...(inReplyTo ? { inReplyTo, references: inReplyTo } : {}),
    })
    if (!result.success) {
      return NextResponse.json({ error: result.error || 'The email was not sent' }, { status: 502 })
    }

    const summary = `To ${b.to.join(', ')}${b.cc.length ? ` (cc ${b.cc.join(', ')})` : ''}\nSubject: ${b.subject}\n\n${b.body}`.slice(0, 4000)
    if (lead) {
      const next = appendLeadActivity(lead, {
        type: 'email',
        note: summary,
        byId: session.user.id,
        byName: repName,
        nextFollowUpAt: b.nextFollowUpAt ?? null,
      })
      const saved = await prisma.lead.update({
        where: { id: lead.id },
        data: next,
        include: { owner: { select: { id: true, username: true, email: true } }, client: true, opportunity: true },
      })
      return NextResponse.json({ ok: true, messageId: result.messageId, lead: saved })
    }

    const now = new Date()
    const activity = await prisma.opportunityActivity.create({
      data: {
        opportunityId: opp!.id,
        type: 'email',
        description: summary,
        createdById: session.user.id,
        screenExtras: {
          subject: `Email: ${b.subject}`,
          status: 'completed',
          completedDate: now.toISOString(),
          outcome: 'Sent',
          createdByName: repName,
        },
      },
    })
    if (b.nextFollowUpAt) {
      await prisma.opportunityActivity.create({
        data: {
          opportunityId: opp!.id,
          type: 'task',
          description: `Chase the email "${b.subject}" sent ${now.toISOString().slice(0, 10)}`,
          scheduledAt: new Date(`${b.nextFollowUpAt}T08:00:00Z`),
          createdById: session.user.id,
          screenExtras: { subject: `Follow up: ${b.subject}`, status: 'scheduled', createdByName: repName },
        },
      })
    }
    await prisma.opportunity.update({ where: { id: opp!.id }, data: { updatedAt: now } })
    await notifyStoreKeysChanged(['deed_oppActivities'])
    return NextResponse.json({ ok: true, messageId: result.messageId, activityId: activity.id })
  })
}
