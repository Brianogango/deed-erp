import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withApiErrorHandling } from '@/lib/auth/api'
import { getServerSession } from '@/lib/auth/server'
import prisma from '@/lib/prisma'
import {
  findOrphanedPostedInvoices,
  listNeverPostedSince,
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
  invoiceIds: z.array(z.string().uuid()).max(50).default([]),
  /**
   * Invoices that never reached the ledger, named one by one by invoice
   * number. Never a filter: the director types the numbers they mean.
   */
  neverPostedNumbers: z.array(z.string().min(3).max(60)).max(20).default([]),
  /**
   * 'invoice_date' posts each journal on its own invoice's date;
   * 'today' posts them all on the current date. Stated explicitly so the
   * decision appears in the request and in the audit log, not in this file.
   */
  entryDate: z.enum(['invoice_date', 'today']),
}).strict()

/**
 * A director session, or the internal secret.
 *
 * The secret path matters for the one job this route exists to do. Remediation
 * is run from the server, and the alternative — pasting a live session cookie
 * into a terminal — puts a credential into shell history and into any
 * screenshot of that terminal, which the project rules forbid. The secret is
 * already in the app's environment, so a runner script reads it from there and
 * it never reaches the screen. Same pattern as backfill-accounting and
 * journal-mirror-failures.
 *
 * Returns the acting user's id when there is a session, and null for the
 * secret path, which has no user behind it.
 */
async function authorize(request: NextRequest): Promise<{ ok: boolean; actorId: string | null }> {
  const internalSecret = process.env.INTERNAL_API_SECRET
  const providedSecret = request.headers.get('x-internal-secret')
  if (internalSecret && providedSecret === internalSecret) return { ok: true, actorId: null }
  const session = await getServerSession()
  if (session?.user && String(session.user.role) === 'director') {
    return { ok: true, actorId: session.user.id }
  }
  return { ok: false, actorId: null }
}

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    if (!(await authorize(request)).ok) {
      return NextResponse.json({ error: 'Only a director can review orphaned invoice journals' }, { status: 403 })
    }
    const invoices = await findOrphanedPostedInvoices()
    return NextResponse.json({
      count: invoices.length,
      totalValue: invoices.reduce((sum, i) => sum + i.totalAmount, 0),
      invoices,
      // For reading only: posted since the 13 Sep cutover, never in the ledger.
      neverPosted: await listNeverPostedSince('2026-09-13'),
    })
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const auth = await authorize(request)
    if (!auth.ok) {
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
        results.push(await repostOrphanedInvoice({ invoiceId: id, entryDate, actorId: auth.actorId }))
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

    // Named by number: invoices that never reached the ledger at all.
    for (const number of parsed.data.neverPostedNumbers) {
      const invoice = await prisma.invoice.findFirst({ where: { invoiceNumber: number.trim() }, select: { id: true, invoiceDate: true } })
      if (!invoice) {
        results.push({ kind: 'skipped', invoiceNumber: number, reason: 'No invoice with that number' })
        continue
      }
      const entryDate = parsed.data.entryDate === 'today' ? new Date() : invoice.invoiceDate
      try {
        results.push(await repostOrphanedInvoice({ invoiceId: invoice.id, entryDate, actorId: auth.actorId, namedNeverPosted: true }))
      } catch (err) {
        console.error(`[repost-never-posted] ${number} failed:`, err)
        results.push({ kind: 'skipped', invoiceNumber: number, reason: err instanceof Error ? err.message : 'Posting failed' })
      }
    }

    return NextResponse.json({
      reposted: results.filter(r => r.kind === 'reposted').length,
      skipped: results.filter(r => r.kind === 'skipped').length,
      results,
    })
  })
}
