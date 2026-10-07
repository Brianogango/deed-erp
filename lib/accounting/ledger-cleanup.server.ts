import 'server-only'

import prisma from '@/lib/prisma'
import { reverseJournalEntry } from '@/lib/accounting/journal-service'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { recordInvoiceTax } from '@/lib/accounting/invoice-tax.server'
import { isPostingRef } from '@/lib/accounting/duplicate-invoice-journals'
import { planDepositDuplicates, type DepositDuplicate } from '@/lib/accounting/ledger-cleanup'

export type VatGap = { invoiceId: string; ref: string; type: string; vat: number; journalId: string }

export async function findLedgerCleanup(): Promise<{ deposits: DepositDuplicate[]; vat: VatGap[] }> {
  const depositEntries = await prisma.journalEntry.findMany({
    where: {
      isPosted: true, isReversed: false, reversalOfId: null,
      OR: [{ ref: { startsWith: 'JRN/DEP/' } }, { ref: { startsWith: 'JRN/REFUND/' } }],
    },
    select: { ref: true, sourceType: true, totalDebit: true, entryDate: true },
  })
  const deposits = planDepositDuplicates(depositEntries.map(e => ({
    ref: e.ref, sourceType: e.sourceType, amount: Number(e.totalDebit), date: e.entryDate.toISOString().slice(0, 10),
  })))

  const taxed = await prisma.invoice.findMany({
    where: { taxAmount: { gt: 0 }, status: { notIn: ['draft', 'cancelled', 'voided'] } },
    select: { id: true, invoiceNumber: true, documentType: true, taxAmount: true },
  })
  const postings = await prisma.journalEntry.findMany({
    where: { invoiceId: { in: taxed.map(i => i.id) }, sourceType: { in: ['invoice', 'bill'] }, isReversed: false, reversalOfId: null },
    select: { id: true, ref: true, invoiceId: true },
  })
  const withTax = new Set((await prisma.taxTransaction.findMany({
    where: { sourceId: { in: taxed.map(i => i.id) } }, select: { sourceId: true }, distinct: ['sourceId'],
  })).map(t => t.sourceId))
  const vat: VatGap[] = []
  for (const inv of taxed) {
    if (withTax.has(inv.id)) continue
    const posting = postings.find(j => j.invoiceId === inv.id && isPostingRef(j.ref, inv.invoiceNumber))
    if (!posting) continue
    vat.push({ invoiceId: inv.id, ref: inv.invoiceNumber, type: String(inv.documentType), vat: Number(inv.taxAmount), journalId: posting.id })
  }
  return { deposits, vat: vat.sort((a, b) => a.ref.localeCompare(b.ref)) }
}

type Result = { ref: string; status: 'fixed' | 'failed'; message: string }

export async function applyLedgerCleanup(actorId: string): Promise<Result[]> {
  const { deposits, vat } = await findLedgerCleanup()
  const results: Result[] = []
  for (const d of deposits) {
    try {
      const original = await prisma.journalEntry.findUniqueOrThrow({ where: { ref: d.ref }, select: { id: true } })
      const rev = await reverseJournalEntry(d.ref, actorId)
      await writeFinancialAudit({
        userId: actorId,
        action: 'reverse_duplicate_deposit_journal',
        entityType: 'journal_entry',
        entityId: original.id,
        relatedJournalId: rev.id,
        oldValues: { ref: d.ref, amount: d.amount },
        newValues: { reversedBy: rev.ref, kept: d.keeps },
      })
      results.push({ ref: d.ref, status: 'fixed', message: `Reversed (duplicate of ${d.keeps})` })
    } catch (err) {
      results.push({ ref: d.ref, status: 'failed', message: err instanceof Error ? err.message : 'could not reverse' })
    }
  }
  for (const g of vat) {
    try {
      await recordInvoiceTax(g.invoiceId, g.journalId)
      results.push({ ref: g.ref, status: 'fixed', message: `VAT record written (KES ${Math.round(g.vat).toLocaleString('en-KE')})` })
    } catch (err) {
      results.push({ ref: g.ref, status: 'failed', message: err instanceof Error ? err.message : 'could not write VAT record' })
    }
  }
  return results
}
