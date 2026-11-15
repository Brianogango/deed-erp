import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const detail = readFileSync('components/modules/InvoiceDetail.tsx', 'utf8')
const trail = readFileSync('components/erp/JobTrail.tsx', 'utf8')

/**
 * The invoice screen said the same things over and over: the reference five
 * times, the payment state six, the due date four, and two separate progress
 * indicators — one of which used goods-receipt wording ("Part received") on a
 * customer invoice while the chip beside it said "Posted".
 */
describe('the invoice screen says each thing once', () => {
  it('keeps one journey, the trail, not a second stepper beside it', () => {
    expect(detail).not.toContain('invoice-detail__workflow')
    expect(detail).not.toContain('invoiceWorkflowSteps')
    // The wording that stepper used never applied to a customer invoice.
    expect(detail).not.toContain('Part received')
  })

  it('leaves the next action to the header button, not the trail as well', () => {
    expect(detail).toContain('showNext={false}')
    // Every other screen still gets it.
    expect(trail).toContain('showNext = true')
  })

  it('shows one chip for where the money stands', () => {
    // "Overdue" instead of the pay-state chip, never in addition to it.
    expect(detail).toContain("? <StatusBadge status=\"cancelled\" label=\"Overdue\" />")
    expect(detail).toContain(': <StatusBadge status={badgeStatus as string} label={payStateLabel} />')
  })

  it('does not repeat the status or the due date inside the money card', () => {
    expect(detail).not.toContain('{PAYMENT_STATUS_LABELS[payState]}')
    expect(detail).not.toContain('<dt>Due date</dt>')
  })

  it('lists only the related records this document actually has', () => {
    expect(detail).toContain("filter(item => item.value !== '0')")
    // The customer is named in the header; it had a tile of its own as well.
    expect(detail).not.toContain("key: 'customer',")
  })
})
