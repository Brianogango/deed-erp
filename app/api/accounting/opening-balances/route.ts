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
import { loadAppState, loadAppStateForWrite, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { labelForRole } from '@/lib/accounting/coa-roles'
import { createJournalEntry } from '@/lib/accounting/journal-service'
import { ensureOpeningBalanceEquityAccount } from '@/lib/accounting/opening-balance-account'
import {
  findDuplicateOpeningBalances,
  isOpeningBalanceDocument,
  repairedMigratedDate,
  openingBalanceCorrectionRef,
  planOpeningBalanceCorrection,
  type CorrectionPlan,
} from '@/lib/finance/opening-balance'

export const dynamic = 'force-dynamic'

const ROLES = ['director', 'finance_officer']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Row = Record<string, any>
type ReportPlan = CorrectionPlan | { action: 'remove'; reason: string; keeperId: string }
type ReportRow = {
  id: string
  ref: string
  type: 'customer_invoice' | 'vendor_bill'
  partner: string
  date: string
  amount: number
  currentJournal: string | null
  plan: ReportPlan
  correctionDate: string
  /** Day-number dates from the first importer, repaired. */
  dateFix: { date?: string; dueDate?: string } | null
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

  // Copies saved by retries of the first importer; never remove one that
  // reached the ledger or has a server invoice behind it.
  const serverInvoiceIds = new Set(uuidIds.length
    ? (await prisma.invoice.findMany({ where: { id: { in: uuidIds } }, select: { id: true } })).map(r => r.id)
    : [])
  const inLedger = (id: string) => serverInvoiceIds.has(id) || journals.some(j => j.invoiceId === id || j.sourceId === id)
  const duplicates = findDuplicateOpeningBalances(docs, inLedger)
  const refById = new Map(docs.map(d => [String(d.id), String(d.ref || d.id)]))

  return docs.map(doc => {
    const ref = String(doc.ref || doc.id)
    const id = String(doc.id)
    const fixedDate = repairedMigratedDate(doc.date)
    const fixedDue = repairedMigratedDate(doc.dueDate)
    const dateFix = fixedDate || fixedDue ? { ...(fixedDate ? { date: fixedDate } : {}), ...(fixedDue ? { dueDate: fixedDue } : {}) } : null
    const base = {
      id, ref,
      type: doc.type === 'vendor_bill' ? 'vendor_bill' as const : 'customer_invoice' as const,
      partner: String(doc.partnerName || ''),
      date: fixedDate ?? String(doc.date || '').slice(0, 10),
      amount: Number(doc.total) || 0,
      dateFix,
    }
    const keeperId = duplicates.remove.get(id)
    if (keeperId) {
      return { ...base, currentJournal: null, correctionDate: '', plan: { action: 'remove' as const, keeperId, reason: `Duplicate copy of ${refById.get(keeperId) ?? ref} from a repeated import — removed` } }
    }
    const blockedReason = duplicates.blocked.get(id)
    if (blockedReason) {
      return { ...base, currentJournal: null, correctionDate: '', plan: { action: 'review' as const, reason: blockedReason } }
    }
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
      doc: { type: base.type, ref, partner: base.partner, amount: base.amount },
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
    return {
      ...base,
      currentJournal: original?.ref ?? null,
      plan: dateFix && (plan.action === 'post' || plan.action === 'reclass')
        ? { ...plan, reason: `${plan.reason}; date ${String(doc.date)} read as ${fixedDate ?? fixedDue}` }
        : plan,
      // A move out of revenue/expense lands in the period that recorded it.
      correctionDate: original && plan.action === 'reclass' ? original.entryDate.toISOString().slice(0, 10) : base.date,
    }
  })
}

/** Remove duplicate copies and repair day-number dates in the stored documents. */
async function repairDocuments(rows: ReportRow[]): Promise<{ removed: number; datesFixed: number }> {
  const removeIds = new Set(rows.filter(r => r.plan.action === 'remove').map(r => r.id))
  const fixes = new Map(rows.filter(r => r.dateFix && r.plan.action !== 'remove').map(r => [r.id, r.dateFix!]))
  if (!removeIds.size && !fixes.size) return { removed: 0, datesFixed: 0 }
  return withAppStateKeyLock('deed_invoices', async () => {
    const state = await loadAppStateForWrite(['deed_invoices'])
    const current = Array.isArray(state.deed_invoices) ? state.deed_invoices as Row[] : []
    let removed = 0
    let datesFixed = 0
    const next = current.flatMap(doc => {
      const id = String(doc.id)
      // Re-checked under the lock: never drop a copy that was paid meanwhile.
      if (removeIds.has(id) && !((Number(doc.amountPaid) || 0) > 0)) { removed += 1; return [] }
      const fix = fixes.get(id)
      if (!fix) return [doc]
      datesFixed += 1
      return [{ ...doc, ...fix }]
    })
    if (removed || datesFixed) {
      // A deliberate, reviewed removal of import copies — not a stale browser.
      await saveStoreKeys({ deed_invoices: JSON.stringify(next) }, { allowBulkDelete: ['deed_invoices'] })
    }
    return { removed, datesFixed }
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
    // First the documents themselves (copies out, dates repaired), then the
    // journals from a fresh report, so they post with the repaired dates.
    const repaired = await repairDocuments(await buildReport())
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
    return NextResponse.json({ results, ...repaired })
  })
}
