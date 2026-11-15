import { describe, expect, it } from 'vitest'
import { closingFigure } from '@/lib/deed-document-pdf'

/**
 * Every commercial document closes on one figure, or none. Getting this wrong
 * either hides what a customer owes or demands money from someone who has
 * already paid.
 */
describe('the figure a document closes on', () => {
  it('shows an invoice what is still owed', () => {
    expect(closingFigure('invoice', 548954, 200000, true)).toMatchObject({ label: 'Balance due', amount: 548954 })
    expect(closingFigure('invoice', 457040, 0, false)).toMatchObject({ label: 'Amount due', amount: 457040 })
  })

  it('asks nothing of an invoice that is settled', () => {
    expect(closingFigure('invoice', 0, 748954, true)).toBeNull()
  })

  it('shows a receipt what was received, not what is owed', () => {
    expect(closingFigure('receipt', 0, 748954, true)).toMatchObject({ label: 'Amount received', amount: 748954 })
  })

  it('leaves a receipt with no payment alone', () => {
    expect(closingFigure('receipt', 0, 0, false)).toBeNull()
  })

  it('never demands money on a quotation, a pro-forma or a delivery note', () => {
    for (const kind of ['quotation', 'proforma', 'delivery'] as const) {
      expect(closingFigure(kind, 457040, 0, false)).toBeNull()
    }
  })

  it('treats a bill the way it treats an invoice', () => {
    expect(closingFigure('bill', 120000, 0, false)).toMatchObject({ label: 'Amount due', amount: 120000 })
  })
})
