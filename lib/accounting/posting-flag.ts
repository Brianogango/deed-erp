/**
 * Feature flag for the Phase 1 central accounting posting engine.
 *
 * Production must run with ACCOUNTING_POSTING_ENGINE=true. Remaining surfaces
 * (expense, POS, bank recon, outstanding payments, stock STK) post through
 * posting-service; they no longer skip when the flag is off.
 *
 * Tests may leave the flag unset. Enable with: ACCOUNTING_POSTING_ENGINE=true
 */

export function isAccountingPostingEngineEnabled(): boolean {
  const v = String(process.env.ACCOUNTING_POSTING_ENGINE || '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'on' || v === 'yes'
}
