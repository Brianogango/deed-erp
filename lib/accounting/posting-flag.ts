/**
 * Feature flag for the Phase 1 central accounting posting engine.
 * Default OFF — existing invoice-journals / persistStoreJournalEntry paths stay live.
 *
 * Enable with: ACCOUNTING_POSTING_ENGINE=true
 */

export function isAccountingPostingEngineEnabled(): boolean {
  const v = String(process.env.ACCOUNTING_POSTING_ENGINE || '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'on' || v === 'yes'
}
