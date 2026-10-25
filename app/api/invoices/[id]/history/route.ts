import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { canReadInvoiceRow } from '@/lib/auth/authorization'
import { resolveRouteParams, type RouteParams } from '@/lib/route-params'
import { listAuthUsers } from '@/lib/auth/users-repository'
import { listDocumentEmailSends } from '@/lib/document-email-sends'
import { describeAuditRow, sortHistory, type HistoryEvent } from '@/lib/finance/invoice-history'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/invoices/[id]/history
 * Who created, edited, confirmed, emailed, paid, reversed or cancelled an
 * invoice or bill, and when — from the server's audit log.
 */
export async function GET(_: Request, { params }: { params: RouteParams<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const { id } = await resolveRouteParams(params)
    if (!UUID_RE.test(id)) return NextResponse.json({ events: [] })

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: { id: true, invoiceNumber: true, documentType: true, repairId: true, totalAmount: true, createdAt: true, createdById: true, postedAt: true, postedById: true },
    })
    if (!invoice || !canReadInvoiceRow(session.user, invoice)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const allocations = await prisma.paymentAllocation.findMany({ where: { invoiceId: id }, select: { paymentId: true } })
    const paymentIds = [...new Set(allocations.map(a => a.paymentId))]

    const rows = await prisma.auditLog.findMany({
      where: {
        OR: [
          { entityType: { in: ['invoice', 'Invoice', 'vendor_bill', 'credit_note'] }, OR: [{ entityId: id }, { entityKey: id }] },
          ...(paymentIds.length ? [{ entityType: 'payment', entityId: { in: paymentIds } }] : []),
          // Actions logged against the document number (screens, correction tools).
          { entityType: 'document', entityKey: invoice.invoiceNumber },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })

    const users = await listAuthUsers().catch(() => [] as Array<{ id: string; name?: string; username?: string }>)
    const names = new Map(users.map((u: any) => [String(u.id), String(u.name || u.username || '')]))
    const userName = (uid: string | null | undefined) => (uid ? names.get(String(uid)) || 'Unknown user' : null)

    const docLabel = Number(invoice.totalAmount) < 0 ? 'Credit note' : invoice.documentType === 'vendor_bill' ? 'Bill' : 'Invoice'
    const events: HistoryEvent[] = []
    for (const r of rows) {
      const e = describeAuditRow({ ...r, id: String(r.id) }, docLabel, userName)
      if (e) events.push(e)
    }

    // Documents from before the audit trail existed still say who made them.
    if (!rows.some(r => r.action.startsWith('create_invoice'))) {
      events.push({ id: 'created', at: invoice.createdAt.toISOString(), action: 'create_invoice', title: `${docLabel} created`, by: userName(invoice.createdById), tone: 'neutral' })
    }
    if (invoice.postedAt && !rows.some(r => r.action === 'post_invoice')) {
      events.push({ id: 'posted', at: invoice.postedAt.toISOString(), action: 'post_invoice', title: `${docLabel} confirmed`, by: userName(invoice.postedById), detail: invoice.invoiceNumber, tone: 'good' })
    }

    const sends = await listDocumentEmailSends({ documentId: id, limit: 100 }).catch(() => [])
    for (const s of sends) {
      events.push({
        id: `send-${s.id}`,
        at: s.sentAt,
        action: 'email',
        title: s.status === 'success' ? `Emailed to ${s.to}` : `Email to ${s.to} failed`,
        by: s.sentByName || userName(s.sentById ?? null),
        detail: [s.cc?.length ? `Cc ${s.cc.join(', ')}` : '', s.subject || '', s.status !== 'success' && s.error ? s.error : ''].filter(Boolean).join(' · ') || undefined,
        tone: s.status === 'success' ? 'good' : 'bad',
      })
    }

    return NextResponse.json({ events: sortHistory(events) })
  })
}
