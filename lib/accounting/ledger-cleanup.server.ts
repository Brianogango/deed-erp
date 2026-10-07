import 'server-only'

import prisma from '@/lib/prisma'
import { reverseJournalEntry } from '@/lib/accounting/journal-service'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { recordInvoiceTax } from '@/lib/accounting/invoice-tax.server'
import { isPostingRef } from '@/lib/accounting/duplicate-invoice-journals'
import { planDepositDuplicates, type DepositDuplicate } from '@/lib/accounting/ledger-cleanup'
import { loadAppState } from '@/lib/server-store'
import { addInvoicesToList } from '@/lib/documents-broadcast.server'

export type VatGap = { invoiceId: string; ref: string; type: string; vat: number; journalId: string }

export type ListGap = { ref: string; date: string; total: number }

/** Documents in the invoices table that the Finance list does not show. */
async function findMissingFromList(): Promise<ListGap[]> {
  const raw = (await loadAppState(['deed_invoices'])).deed_invoices
  const rows = Array.isArray(raw) ? raw as Array<Record<string, unknown>> : []
  const ids = new Set(rows.map(r => String(r?.id ?? '')))
  const refs = new Set(rows.map(r => String(r?.ref ?? '')))
  const all = await prisma.invoice.findMany({ select: { id: true, invoiceNumber: true, invoiceDate: true, totalAmount: true } })
  return all
    .filter(i => !ids.has(i.id) && !refs.has(i.invoiceNumber))
    .map(i => ({ ref: i.invoiceNumber, date: i.invoiceDate ? i.invoiceDate.toISOString().slice(0, 10) : '', total: Number(i.totalAmount) }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

export async function findLedgerCleanup(): Promise<{ deposits: DepositDuplicate[]; vat: VatGap[]; listMissing: ListGap[] }> {
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
  return { deposits, vat: vat.sort((a, b) => a.ref.localeCompare(b.ref)), listMissing: await findMissingFromList() }
}

type Result = { ref: string; status: 'fixed' | 'failed'; message: string }

export async function applyLedgerCleanup(actorId: string): Promise<Result[]> {
  const { deposits, vat, listMissing } = await findLedgerCleanup()
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
  if (listMissing.length) {
    try {
      const added = await addInvoicesToList()
      for (const ref of added) results.push({ ref, status: 'fixed', message: 'Added to the Finance list' })
    } catch (err) {
      results.push({ ref: 'Finance list', status: 'failed', message: err instanceof Error ? err.message : 'could not update the list' })
    }
  }
  return results
}
