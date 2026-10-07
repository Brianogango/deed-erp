import 'server-only'

import prisma from '@/lib/prisma'
import { createJournalEntryInTx } from '@/lib/accounting/journal-service'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'
import { planCancelledStillBooked, planDuplicateInvoiceJournals, type DuplicateInvoicePlan } from '@/lib/accounting/duplicate-invoice-journals'

export async function findDuplicateInvoiceJournals(): Promise<DuplicateInvoicePlan[]> {
  // Bills post with source 'bill', invoices (and the import's copies of
  // either) with 'invoice'; the planner keeps only true posting refs, so a
  // delivery charge or payment carrying the same document id is never counted.
  const entries = await prisma.journalEntry.findMany({
    where: { sourceType: { in: ['invoice', 'bill'] }, isReversed: false, reversalOfId: null, invoiceId: { not: null } },
    select: { id: true, ref: true, invoiceId: true, createdAt: true, createdById: true, totalDebit: true },
  })
  const withEntries = [...new Set(entries.map(e => e.invoiceId!))]
  if (!withEntries.length) return []
  const invoices = await prisma.invoice.findMany({
    where: { id: { in: withEntries } },
    select: { id: true, invoiceNumber: true, totalAmount: true, status: true, client: { select: { name: true } } },
  })
  const shape = (i: (typeof invoices)[number]) => ({ id: i.id, invoiceNumber: i.invoiceNumber, customer: i.client?.name ?? '', total: Number(i.totalAmount) })
  const lite = entries.map(e => ({ ...e, invoiceId: e.invoiceId!, totalDebit: Number(e.totalDebit) }))
  const cancelled = invoices.filter(i => ['cancelled', 'voided'].includes(String(i.status)))
  return [
    ...planCancelledStillBooked(cancelled.map(shape), lite),
    ...planDuplicateInvoiceJournals(invoices.filter(i => !cancelled.includes(i)).map(shape), lite),
  ]
}

/** Reverse every extra copy, dated today (the periods they sit in may be closed). */
export async function reverseDuplicateInvoiceJournals(actorId: string) {
  const plans = await findDuplicateInvoiceJournals()
  const today = new Date()
  const results: Array<{ invoiceNumber: string; reversed: number; status: 'fixed' | 'failed'; message: string }> = []
  for (const plan of plans) {
    try {
      await prisma.$transaction(async tx => {
        for (const extra of plan.reverse) {
          const original = await tx.journalEntry.findUniqueOrThrow({ where: { id: extra.id }, include: { lines: true, journal: { select: { code: true } } } })
          if (original.isReversed) continue
          const reversal = await createJournalEntryInTx(tx, {
            ref: `REV/${original.ref}`.slice(0, 80),
            journalCode: original.journal?.code ?? undefined,
            date: today,
            description: (plan.keep
              ? `Duplicate sales entry reversed — ${original.ref} (kept ${plan.keep.ref})`
              : `Cancelled ${plan.invoiceNumber} — entry reversed (${original.ref})`).slice(0, 500),
            sourceType: 'invoice_duplicate_fix',
            sourceId: original.id,
            invoiceId: original.invoiceId,
            createdById: actorId,
            skipIfExists: true,
            lines: original.lines.map(l => ({
              accountLabel: l.accountLabel,
              label: `Reversal: ${l.label ?? ''}`,
              debit: Number(l.credit),
              credit: Number(l.debit),
              partnerId: l.partnerId,
              analyticAccountId: l.analyticAccountId,
            })),
          })
          await tx.journalEntry.update({ where: { id: original.id }, data: { isReversed: true } })
          await tx.journalEntry.update({ where: { id: reversal.id }, data: { reversalOfId: original.id } })
        }
        if (plan.keep) await tx.invoice.update({ where: { id: plan.invoiceId }, data: { postedJournalEntryId: plan.keep.id } })
        await writeFinancialAuditInTx(tx, {
          userId: actorId,
          action: 'reverse_duplicate_invoice_journals',
          entityType: 'invoice',
          entityId: plan.invoiceId,
          oldValues: { reason: plan.reason, liveEntries: [...(plan.keep ? [plan.keep.ref] : []), ...plan.reverse.map(r => r.ref)] },
          newValues: { kept: plan.keep?.ref ?? null, reversed: plan.reverse.map(r => r.ref) },
        })
      }, { isolationLevel: 'Serializable' })
      results.push({ invoiceNumber: plan.invoiceNumber, reversed: plan.reverse.length, status: 'fixed', message: plan.keep ? `Kept ${plan.keep.ref}` : 'Cancelled — all entries reversed' })
    } catch (err) {
      results.push({ invoiceNumber: plan.invoiceNumber, reversed: 0, status: 'failed', message: err instanceof Error ? err.message : 'could not post' })
    }
  }
  return results
}
