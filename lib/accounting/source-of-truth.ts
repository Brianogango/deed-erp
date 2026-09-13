/**
 * Accounting source-of-truth controls.
 *
 * Prisma is the only reporting source. The legacy journal blob remains an
 * archive/compatibility write target until an explicit, certified writer
 * cutover is enabled. Environment switches never bypass parity, certificate,
 * or archive gates in journal-retire-readiness.
 */

export type AccountingSourceOfTruth = 'prisma'

export function accountingReportSourceOfTruth(): AccountingSourceOfTruth {
  return 'prisma'
}

function enabled(value: unknown): boolean {
  return ['1', 'true', 'on', 'yes'].includes(String(value || '').trim().toLowerCase())
}

export function journalWritersMigratedOffBlob(): boolean {
  return enabled(process.env.ACCOUNTING_PRISMA_JOURNAL_WRITERS)
}

export function storeStillWritesJournalBlob(): boolean {
  return !journalWritersMigratedOffBlob()
}

export function accountingCutoverState() {
  const writersMigrated = journalWritersMigratedOffBlob()
  return {
    reportSource: accountingReportSourceOfTruth(),
    writersMigratedOffBlob: writersMigrated,
    storeStillBlobWrites: !writersMigrated,
  } as const
}
