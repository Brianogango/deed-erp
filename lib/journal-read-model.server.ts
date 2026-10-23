import 'server-only'

import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { cachedByFingerprint } from '@/lib/read-model-cache'

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
/**
 * Every posted journal for the screens. Building it reads every entry with all
 * its lines (0.4–1.2 s on production) and it was rebuilt on every load that
 * included journals. It is now kept until the journals change: new, reversed
 * or relinked entries, or any change in line counts or amounts. Edits made in
 * place only touch is_reversed, reversal_of_id and the invoice / payment /
 * source links, which the fingerprint covers.
 */
export async function loadScreenJournals(): Promise<ReturnType<typeof mapJournalForScreen>[]> {
  return cachedByFingerprint(
    'journals',
    async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ fp: string | null }>>(`
        SELECT concat_ws('|',
          (SELECT count(*) || ':' || max(created_at)::text || ':' || count(*) FILTER (WHERE is_posted)
                  || ':' || count(*) FILTER (WHERE is_reversed) || ':' || count(reversal_of_id)
                  || ':' || md5(coalesce(string_agg(
                       coalesce(invoice_id::text, '') || '/' || coalesce(payment_id::text, '') || '/' || coalesce(source_id::text, ''),
                       ',' ORDER BY id), ''))
             FROM journal_entries),
          (SELECT count(*) || ':' || coalesce(sum(debit), 0) || ':' || coalesce(sum(credit), 0) || ':' || max(created_at)::text
             FROM journal_entry_lines)
        ) AS fp`)
      return rows[0]?.fp ?? ''
    },
    buildJournalsIncrementally,
  )
}

type ScreenJournal = ReturnType<typeof mapJournalForScreen>

/**
 * One row per posted entry: its id and a hash of its header, links and
 * totals, newest first — the same order as the full list. Lines are written
 * only together with their entry (journal-service) and never edited after,
 * so the header covers them; hashing every line would double the cost.
 */
const ENTRY_SIGNATURES_SQL = `
  SELECT e.id::text AS id, md5(concat_ws('/',
           e.ref, e.entry_date::text, e.description, e.source_type, e.source_id, e.journal_id::text,
           e.is_reversed::text, e.reversal_of_id::text, e.invoice_id::text, e.payment_id::text, e.blob_id,
           e.total_debit::text, e.total_credit::text)) AS sig
    FROM journal_entries e
   WHERE e.is_posted
   ORDER BY e.entry_date DESC, e.created_at DESC`

/** Changed entries above this many: read the whole list instead. */
const INCREMENTAL_LIMIT = 400

/** The last list built, by entry id, with each entry's hash. */
let lastBuilt: Map<string, { sig: string; row: ScreenJournal }> | null = null

/**
 * A new posting used to re-read every entry with all its lines (0.5–0.9 s on
 * production) — on every invoice, payment or bill. Now only entries that are
 * new or whose hash changed are read; the rest are reused from the last build.
 * Runs only when the list's check (loadScreenJournals) has seen a change.
 * Signatures are taken before rows are read: an entry that changes in between
 * keeps its older hash and is simply read again next time.
 */
async function buildJournalsIncrementally(): Promise<ScreenJournal[]> {
  let sigs: Array<{ id: string; sig: string }>
  try {
    sigs = await prisma.$queryRawUnsafe<Array<{ id: string; sig: string }>>(ENTRY_SIGNATURES_SQL)
  } catch {
    lastBuilt = null
    return (await loadRows()).map(mapJournalForScreen)
  }
  if (!Array.isArray(sigs)) sigs = []
  const previous = lastBuilt
  const changed = sigs.filter(s => previous?.get(s.id)?.sig !== s.sig).map(s => s.id)

  let fresh: Map<string, ScreenJournal>
  // Something changed (the caller's check said so) but no entry looks
  // different: a change the hashes do not see, so read everything.
  if (!previous || changed.length > INCREMENTAL_LIMIT || (changed.length === 0 && sigs.length === previous.size)) {
    fresh = new Map((await loadRows()).map(e => [e.id, mapJournalForScreen(e)]))
  } else {
    fresh = new Map()
    for (let i = 0; i < changed.length; i += 200) {
      const rows = await loadRows({ id: { in: changed.slice(i, i + 200) } })
      for (const e of rows) fresh.set(e.id, mapJournalForScreen(e))
    }
  }

  const next = new Map<string, { sig: string; row: ScreenJournal }>()
  const out: ScreenJournal[] = []
  for (const s of sigs) {
    const row = fresh.get(s.id) ?? previous?.get(s.id)?.row
    if (!row) continue // posted after the signatures were taken, or no longer posted
    next.set(s.id, { sig: fresh.has(s.id) || previous?.get(s.id)?.sig === s.sig ? s.sig : '', row })
    out.push(row)
  }
  lastBuilt = next
  return out
}

/** For tests. */
export function resetJournalSnapshot(): void {
  lastBuilt = null
}
