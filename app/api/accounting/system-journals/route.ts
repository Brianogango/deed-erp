import { NextRequest, NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { canWriteStoreKey } from '@/lib/auth/store-write-policy'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { persistStoreJournalEntry } from '@/lib/accounting/journal-service'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

/**
 * POST /api/accounting/system-journals
 *
 * Posts a journal that a domain action built in the browser directly into
 * journal_entries.
 *
 * Why this exists: Prisma is the sole reporting source of truth, but a handful
 * of flows had no server endpoint that posted their journal — fixed-asset
 * capitalisation and depreciation, POS session close, RMA refunds, buy-back
 * store credit, credit notes raised from a sale order, and delivery charges
 * added to an already-posted invoice. Their only route into the ledger was the
 * blob mirror replaying deed_journalEntries. That made the blob load-bearing
 * for correctness and blocked retiring it.
 *
 * This is NOT the manual-journal endpoint. /api/accounting/journals is for a
 * human keying an entry by hand and deliberately stamps sourceType 'manual' so
 * an API caller cannot claim system provenance. Here the provenance comes from
 * `kind`, which is a closed set, and the client cannot choose it freely.
 *
 * Authorisation reuses the write policy of the blob key that owns the
 * underlying record, so posting the journal needs exactly the roles and module
 * access that performing the action needs — a cashier can close a POS session,
 * and cannot capitalise an asset.
 *
 * Persistence goes through persistStoreJournalEntry, the same function the
 * mirror calls, so rows written here are indistinguishable from the ones the
 * mirror used to produce. It dedupes on ref, which makes a retry safe and
 * means the mirror skips anything this route already posted.
 */

const SYSTEM_JOURNAL_KINDS = {
  fixed_asset: { source: 'adjustment', governingKey: 'deed_companyAssets' },
  pos_session: { source: 'pos_session', governingKey: 'deed_posSessions' },
  rma_refund: { source: 'refund', governingKey: 'deed_returnOrders' },
  buyback_credit: { source: 'manual', governingKey: 'deed_buyBacks' },
  sale_order_credit_note: { source: 'manual', governingKey: 'deed_customerCredits' },
  invoice_adjustment: { source: 'invoice', governingKey: 'deed_invoices' },
} as const

export type SystemJournalKind = keyof typeof SYSTEM_JOURNAL_KINDS

const lineSchema = z.object({
  account: z.string().trim().min(1).max(200),
  description: z.string().trim().max(300).optional().nullable(),
  debit: z.coerce.number().finite().nonnegative().max(99_999_999_999.99).default(0),
  credit: z.coerce.number().finite().nonnegative().max(99_999_999_999.99).default(0),
})

const systemJournalSchema = z.object({
  kind: z.enum(Object.keys(SYSTEM_JOURNAL_KINDS) as [SystemJournalKind, ...SystemJournalKind[]]),
  id: z.string().trim().max(80).optional().nullable(),
  ref: z.string().trim().min(1).max(80),
  date: z.string().trim().min(1).max(40),
  description: z.string().trim().max(500).optional().nullable(),
  invoiceId: z.string().trim().max(80).optional().nullable(),
  paymentId: z.string().trim().max(80).optional().nullable(),
  lines: z.array(lineSchema).min(2).max(100),
}).strict()

/** journal-service throws with a status for the cases a caller can act on. */
function postingStatus(err: unknown): number {
  const status = (err as { status?: unknown })?.status
  return typeof status === 'number' ? status : 500
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const parsed = systemJournalSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Invalid system journal',
          issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
        },
        { status: 422 },
      )
    }
    const body = parsed.data
    const kind = SYSTEM_JOURNAL_KINDS[body.kind]

    if (!canWriteStoreKey(session.user, kind.governingKey)) {
      return NextResponse.json(
        { error: 'You do not have permission to post this journal' },
        { status: 403 },
      )
    }

    const day = body.date.slice(0, 10)
    const parsedDate = new Date(`${day}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(parsedDate.getTime())) {
      return NextResponse.json({ error: 'Invalid journal date' }, { status: 422 })
    }

    const lock = await checkFiscalLock(day)
    if (!lock.ok) {
      return NextResponse.json({ error: lock.error }, { status: lock.status })
    }

    try {
      const entry = await persistStoreJournalEntry({
        id: body.id || undefined,
        ref: body.ref,
        date: day,
        // Server-assigned from `kind`. A caller cannot label its own entry.
        source: kind.source,
        description: body.description || body.ref,
        invoiceId: body.invoiceId || undefined,
        paymentId: body.paymentId || undefined,
        lines: body.lines.map(l => ({
          account: l.account,
          description: l.description || undefined,
          debit: l.debit,
          credit: l.credit,
        })),
      }, { createdById: session.user.id })

      return NextResponse.json({ journal: { id: entry.id, ref: entry.ref } }, { status: 201 })
    } catch (err) {
      const status = postingStatus(err)
      const message = err instanceof Error ? err.message : 'Journal could not be posted'
      if (status >= 500) console.error(`[system-journals] ${body.kind} ${body.ref} failed:`, err)
      return NextResponse.json({ error: message }, { status })
    }
  })
}
