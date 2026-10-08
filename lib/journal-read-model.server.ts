import 'server-only'

import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'

/**
 * Journal entries as the screens use them, read from journal_entries.
 *
 * Every flow that books an entry already books it on the server; the
 * deed_journalEntries screen copy only held the browser's own copies, which
 * the journal mirror then booked a second time — under a different ref when
 * the browser's payment id differed from the server's (payments booked
 * twice), or as an unlinked manual "REV/" entry (documents reset to draft
 * still counted as booked). The copy is frozen and the mirror no longer runs.
 *
 * All posted entries are listed, reversed ones and their reversals included,
 * so balances worked out on the screens net the same as the ledger.
 */

type DbJournal = Awaited<ReturnType<typeof loadRows>>[number]

async function loadRows(where?: Prisma.JournalEntryWhereInput, take?: number) {
  return prisma.journalEntry.findMany({
    where: { isPosted: true, ...(where ?? {}) },
    include: { lines: { orderBy: { sortOrder: 'asc' } }, journal: true },
    orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
    ...(take ? { take } : {}),
  })
}

export function mapJournalForScreen(e: DbJournal) {
  return {
    id: e.id,
    ref: e.ref,
    date: e.entryDate.toISOString().slice(0, 10),
    source: e.sourceType || e.journal?.journalType || 'general',
    description: e.description || '',
    status: e.isPosted ? 'posted' : 'draft',
    totalDebit: Number(e.totalDebit),
    totalCredit: Number(e.totalCredit),
    invoiceId: e.invoiceId || undefined,
    paymentId: e.paymentId || undefined,
    sourceId: e.sourceId || undefined,
    isReversed: e.isReversed || undefined,
    reversalOfId: e.reversalOfId || undefined,
    payrollRunId: e.sourceType === 'payroll_payment' ? (e.sourceId || undefined) : undefined,
    bankAccountId: e.sourceType === 'payroll_payment' && e.blobId?.startsWith('bank:')
      ? e.blobId.slice('bank:'.length)
      : undefined,
    lines: e.lines.map(l => ({
      id: l.id,
      account: l.accountLabel,
      description: l.label || '',
      debit: Number(l.debit),
      credit: Number(l.credit),
      analyticAccountId: l.analyticAccountId,
    })),
  }
}

/** For GET /api/accounting/journals: live entries, filtered. */
export async function findJournalsForScreen(where: Prisma.JournalEntryWhereInput, take: number) {
  return (await loadRows(where, take)).map(mapJournalForScreen)
}

/** The full journal list for the screens (store hydration). */
export async function loadScreenJournals(): Promise<ReturnType<typeof mapJournalForScreen>[]> {
  return (await loadRows()).map(mapJournalForScreen)
}
