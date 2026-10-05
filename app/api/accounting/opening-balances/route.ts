/**
 * Opening balances imported before they were posted to 4004 Opening Balance
 * Equity (lib/finance/opening-balance.ts).
 *
 * GET  — the review report: every migrated opening balance, how it is posted
 *        today, and the correcting journal it needs. Changes nothing.
 * POST — post those corrections. Each document gets at most one correcting
 *        journal (fixed ref), so running it twice changes nothing more.
 */
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState } from '@/lib/server-store'
import { labelForRole } from '@/lib/accounting/coa-roles'
import { createJournalEntry } from '@/lib/accounting/journal-service'
import { ensureOpeningBalanceEquityAccount } from '@/lib/accounting/opening-balance-account'
import {
  isOpeningBalanceDocument,
  openingBalanceCorrectionRef,
  planOpeningBalanceCorrection,
  type CorrectionPlan,
} from '@/lib/finance/opening-balance'

export const dynamic = 'force-dynamic'

const ROLES = ['director', 'finance_officer']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Row = Record<string, any>
type ReportRow = {
  id: string
  ref: string
  type: 'customer_invoice' | 'vendor_bill'
  partner: string
  date: string
  amount: number
  currentJournal: string | null
  plan: CorrectionPlan
  correctionDate: string
}

async function buildReport(): Promise<ReportRow[]> {
  const state = await loadAppState(['deed_invoices'])
  const docs = (Array.isArray(state.deed_invoices) ? state.deed_invoices as Row[] : [])
    .filter(doc => isOpeningBalanceDocument(doc) && doc.status !== 'cancelled' && doc.status !== 'draft')
  if (!docs.length) return []

  const arLabel = labelForRole('ar')
  const apLabel = labelForRole('ap')
  const refs = docs.map(d => String(d.ref || d.id))
  const uuidIds = docs.map(d => String(d.id)).filter(id => UUID.test(id))

  const journals = await prisma.journalEntry.findMany({
    where: {
      OR: [
        ...(uuidIds.length ? [{ invoiceId: { in: uuidIds } }] : []),
        { sourceId: { in: docs.map(d => String(d.id)) } },
        { ref: { in: refs.flatMap(ref => [`JRN/${ref}`, `JRN/OB/${ref}`, `JRN/OBFIX/${ref}`].map(r => r.slice(0, 80))) } },
        ...refs.map(ref => ({ ref: { startsWith: `JRN/${ref}/`.slice(0, 80) } })),
      ],
    },
    select: {
      id: true, ref: true, entryDate: true, isReversed: true, invoiceId: true, sourceId: true, sourceType: true,
      lines: { select: { accountLabel: true, debit: true, credit: true, account: { select: { accountType: true } } } },
    },
  })

  return docs.map(doc => {
    const ref = String(doc.ref || doc.id)
    const type = doc.type === 'vendor_bill' ? 'vendor_bill' as const : 'customer_invoice' as const
    const own = `JRN/${ref}`.slice(0, 80)
    const isOwnRef = (r: string) => r === own || r.startsWith(`${own}/`)
    const correctionRefs = [openingBalanceCorrectionRef(ref, 'post'), openingBalanceCorrectionRef(ref, 'reclass')]
    const mine = journals.filter(j => j.invoiceId === doc.id || j.sourceId === String(doc.id) || isOwnRef(j.ref) || correctionRefs.includes(j.ref))
    const corrected = mine.some(j => correctionRefs.includes(j.ref))
    // The document's own posting (not a correction, not a payment); a live
    // one over one that was reversed and re-posted.
    const postings = mine.filter(j => !correctionRefs.includes(j.ref) && (isOwnRef(j.ref) || j.sourceType === 'invoice' || j.sourceType === 'bill'))
    const original = postings.find(j => !j.isReversed) ?? postings[0]
    const plan = planOpeningBalanceCorrection({
      doc: { type, ref, partner: String(doc.partnerName || ''), amount: Number(doc.total) || 0 },
      journal: original
        ? {
            isReversed: original.isReversed,
            lines: original.lines.map(l => ({
              accountLabel: l.accountLabel,
              accountType: l.account?.accountType ?? null,
              debit: Number(l.debit),
              credit: Number(l.credit),
            })),
          }
        : null,
      alreadyCorrected: corrected,
      arLabel,
      apLabel,
    })
    const docDate = String(doc.date || '').slice(0, 10)
    return {
      id: String(doc.id),
      ref,
      type,
      partner: String(doc.partnerName || ''),
      date: docDate,
      amount: Number(doc.total) || 0,
      currentJournal: original?.ref ?? null,
      plan,
      // A move out of revenue/expense lands in the period that recorded it.
      correctionDate: original && plan.action === 'reclass' ? original.entryDate.toISOString().slice(0, 10) : docDate,
    }
  })
}

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(ROLES)
    const rows = await buildReport()
    return NextResponse.json({ rows })
  })
}

export async function POST() {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(ROLES)
    await ensureOpeningBalanceEquityAccount()
    const rows = await buildReport()
    const results: Array<{ ref: string; status: 'posted' | 'skipped' | 'failed'; message: string; journalRef?: string }> = []
    for (const row of rows) {
      const plan = row.plan
      if (plan.action !== 'post' && plan.action !== 'reclass') {
        results.push({ ref: row.ref, status: 'skipped', message: plan.reason })
        continue
      }
      const journalRef = openingBalanceCorrectionRef(row.ref, plan.action)
      try {
        await createJournalEntry({
          ref: journalRef,
          journalCode: 'GEN',
          date: row.correctionDate,
          description: plan.action === 'post'
            ? `Opening balance ${row.ref} — ${row.partner}`
            : `Opening balance ${row.ref} — ${row.partner}: moved to Opening Balance Equity`,
          sourceType: 'opening_balance',
          sourceId: row.id,
          invoiceId: UUID.test(row.id) ? row.id : null,
          createdById: actor.id,
          skipIfExists: true,
          lines: plan.lines.map(l => ({ accountLabel: l.accountLabel, label: l.label, debit: l.debit, credit: l.credit })),
        })
        results.push({ ref: row.ref, status: 'posted', message: plan.reason, journalRef })
      } catch (err) {
        results.push({ ref: row.ref, status: 'failed', message: err instanceof Error ? err.message : 'Could not post' })
      }
    }
    return NextResponse.json({ results })
  })
}
