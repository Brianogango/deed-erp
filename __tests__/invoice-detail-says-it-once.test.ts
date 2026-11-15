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

  it('breaks the money down only while a payment is part way through', () => {
    // Untouched, the card said "Balance due 4,800", then "Invoice total
    // 4,800", then "Received 0", then a bar at 0%.
    expect(detail).toContain('const partPaid = invoice.amountPaid > 0 && balance > 0')
    expect(detail).toContain('{partPaid && (')
  })

  it('names the document once in the trail, not again on its payment', () => {
    const trailSrc = readFileSync('lib/job-trail.ts', 'utf8')
    expect(trailSrc).toContain("kind: 'payment', label: 'Payment', ref: ''")
    expect(trail).toContain('{step.ref ? <span className="font-mono">{step.ref}</span> : null}')
  })

  it('lists only the related records this document actually has', () => {
    expect(detail).toContain("filter(item => item.value !== '0')")
    // The customer is named in the header; it had a tile of its own as well.
    expect(detail).not.toContain("key: 'customer',")
  })
})
