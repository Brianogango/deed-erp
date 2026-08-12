/**
 * Whether journal blob writers are considered migrated for retire readiness.
 * Default false — blob UI journals still write deed_journalEntries.
 * Set JOURNAL_WRITERS_MIGRATED=true only after dual-write soak + Finance sign-off.
 */
export function areJournalWritersMigratedOffBlob(): boolean {
  const v = String(process.env.JOURNAL_WRITERS_MIGRATED || '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'on' || v === 'yes'
}
