import { describe, expect, it } from 'vitest'
import { SALE_STATUS_BAR } from '@/lib/odoo-sales-flow'

/** Mirrors SalesRecordHeader step-advance rules for unit testing. */
function isSaleStepClickable(
  status: string,
  step: string,
  index: number,
  lineCount: number,
  approvalStatus?: string,
) {
  if (status === 'cancelled' || approvalStatus === 'pending') return false
  const currentIdx = Math.max(0, SALE_STATUS_BAR.indexOf(status as typeof SALE_STATUS_BAR[number]))
  if (index !== currentIdx + 1 || lineCount === 0) return false
  if (step === 'quotation_sent') return status === 'quotation'
  if (step === 'sale') return status === 'quotation' || status === 'quotation_sent'
  return false
}

describe('sales status stepper click rules', () => {
  it('allows send only from quotation to quotation_sent', () => {
    expect(isSaleStepClickable('quotation', 'quotation_sent', 1, 1)).toBe(true)
    expect(isSaleStepClickable('quotation_sent', 'quotation_sent', 1, 1)).toBe(false)
    expect(isSaleStepClickable('quotation', 'sale', 2, 1)).toBe(false)
  })

  it('allows confirm from quotation_sent to sale', () => {
    expect(isSaleStepClickable('quotation_sent', 'sale', 2, 2)).toBe(true)
    expect(isSaleStepClickable('quotation', 'sale', 2, 2)).toBe(false)
  })

  it('blocks when approval is pending or lines are empty', () => {
    expect(isSaleStepClickable('quotation', 'quotation_sent', 1, 0)).toBe(false)
    expect(isSaleStepClickable('quotation', 'quotation_sent', 1, 1, 'pending')).toBe(false)
  })
})
