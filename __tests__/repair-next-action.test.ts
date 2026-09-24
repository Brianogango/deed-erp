import { describe, it, expect } from 'vitest'
import { startableStatusesForPath, quotableStatusesForPath } from '@/lib/repair-path'
import { pickRepairPrimaryAction } from '@/lib/repair-handover'

/**
 * REGRESSION 24-Sep-2026 — an approved repair assigned to a technician showed
 * "Update or re-send the quote to move forward" to everyone else, with an
 * Update quote button that never went away: only the assigned technician can
 * start the work, so the job could not advance from that screen.
 */
describe('an approved repair is waiting on its technician, not on the quote', () => {
  it('approved is both startable and quotable — the overlap that caused it', () => {
    expect(startableStatusesForPath('standard')).toContain('approved')
    expect(quotableStatusesForPath('standard')).toContain('approved')
  })

  it('the quote is no longer the dominant action while the technician is awaited', () => {
    // What RepairDetailView now passes: canQuote is withheld when the job is
    // startable by someone else.
    const flags = {
      canVerify: false, canMarkPartsArrived: false, canStart: false, canComplete: false,
      canPerformQA: false, canInvoice: false, canPrepareRelease: false, canMarkCollected: false,
      canCloseJob: false, canDiagnose: false, canUpdateDiagnosis: false, canAssign: false,
      quoteDeclinedReopenable: false, noCharge: false, serialNumber: 'SN1',
    }
    expect(pickRepairPrimaryAction({ ...flags, canQuote: true })).toBe('quote')
    expect(pickRepairPrimaryAction({ ...flags, canQuote: false })).toBeNull()
  })

  it('a declined quote still offers the revision, since that IS the next step', () => {
    expect(pickRepairPrimaryAction({
      canVerify: false, canMarkPartsArrived: false, canStart: false, canComplete: false,
      canPerformQA: false, canInvoice: false, canPrepareRelease: false, canMarkCollected: false,
      canCloseJob: false, canDiagnose: false, canUpdateDiagnosis: false, canAssign: false,
      quoteDeclinedReopenable: true, canQuote: true, noCharge: false, serialNumber: 'SN1',
    })).toBe('quote')
  })
})
