import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import {
  findOrphanedPostedInvoices,
  repostOrphanedInvoice,
  type RepostOutcome,
} from '@/lib/accounting/orphaned-invoice-journals'

export const dynamic = 'force-dynamic'

/**
 * GET  /api/accounting/orphaned-invoice-journals — list invoices the ledger lost
 * POST /api/accounting/orphaned-invoice-journals — re-post named ones
 *
 * The un-posting defect (fixed 2026-09-27) left invoices in a posted status
 * with their GL journal reversed. The normal recovery — Reset to Draft, then
 * Confirm — is closed to them, because resetting an invoice that carries
 * payments is refused by design: "Invoices with payments cannot be reset."
 * That refusal is correct and should stay. This route is the narrow way back
 * in for the invoices the bug stranded.
 *
 * Director only, and never bulk. The caller names each invoice id and names
 * the journal date, because that date is an accounting judgement — the
 * original invoice date puts the revenue in the month it was earned but
 * reopens a closed period, while today's date protects the close and misstates
 * the month. Neither belongs in a default. Whatever is chosen, the fiscal lock
 * still gets the last word.
 */

const RepostSchema = z.object({
  invoiceIds: z.array(z.string().uuid()).min(1).max(50),
  /**
   * 'invoice_date' posts each journal on its own invoice's date;
   * 'today' posts them all on the current date. Stated explicitly so the
   * decision appears in the request and in the audit log, not in this file.
   */
  entryDate: z.enum(['invoice_date', 'today']),
}).strict()

const DIRECTOR_ROLES = ['director']

export async function GET() {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!DIRECTOR_ROLES.includes(String(session.user.role))) {
      return NextResponse.json({ error: 'Only a director can review orphaned invoice journals' }, { status: 403 })
    }
    const invoices = await findOrphanedPostedInvoices()
    return NextResponse.json({
      count: invoices.length,
      totalValue: invoices.reduce((sum, i) => sum + i.totalAmount, 0),
      invoices,
    })
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!DIRECTOR_ROLES.includes(String(session.user.role))) {
      return NextResponse.json({ error: 'Only a director can re-post an invoice journal' }, { status: 403 })
    }

    const parsed = RepostSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'invoiceIds and entryDate are required' }, { status: 422 })
    }

    // The re-post list is checked against the live orphan set rather than taken
    // on trust, so a stale id — or a healthy invoice named by mistake — cannot
    // mint a duplicate journal against a document that is already in the ledger.
    const orphans = await findOrphanedPostedInvoices()
    const byId = new Map(orphans.map(o => [o.id, o]))

    const results: RepostOutcome[] = []
    for (const id of parsed.data.invoiceIds) {
      const orphan = byId.get(id)
      if (!orphan) {
        results.push({ kind: 'skipped', invoiceNumber: id, reason: 'Not currently an orphaned invoice' })
        continue
      }
      const entryDate = parsed.data.entryDate === 'today' ? new Date() : orphan.invoiceDate
      try {
        results.push(await repostOrphanedInvoice({ invoiceId: id, entryDate, actorId: session.user.id }))
      } catch (err) {
        // One failure must not abandon the rest: each invoice is its own
        // journal and its own decision.
        console.error(`[repost-orphan] ${orphan.invoiceNumber} failed:`, err)
        results.push({
          kind: 'skipped',
          invoiceNumber: orphan.invoiceNumber,
          reason: err instanceof Error ? err.message : 'Posting failed',
        })
      }
    }

    return NextResponse.json({
      reposted: results.filter(r => r.kind === 'reposted').length,
      skipped: results.filter(r => r.kind === 'skipped').length,
      results,
    })
  })
}
