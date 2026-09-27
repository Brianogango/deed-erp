import { describe, expect, it } from 'vitest'
import {
  repairPriceChangeImpact,
  describeRepairPriceChange,
} from '@/lib/repair/document-impact'

const posted = { ref: 'INV/2026/0255', status: 'posted' }
const draftInvoice = { ref: 'INV/2026/0301', status: 'draft' }
const confirmedSo = { ref: 'SO/2026/0042', status: 'sale' }
const quotationSo = { ref: 'SO/2026/0043', status: 'quotation' }

describe('repairPriceChangeImpact — nothing to say', () => {
  it('stays quiet when the total did not move', () => {
    const r = repairPriceChangeImpact({ previousTotal: 4480, nextTotal: 4480, invoice: posted })
    expect(r.changed).toBe(false)
    expect(r.impacts).toEqual([])
    expect(r.needsAttention).toBe(false)
  })

  it('treats sub-shilling drift as rounding, not a re-price', () => {
    expect(repairPriceChangeImpact({ previousTotal: 4480, nextTotal: 4480.4, invoice: posted }).changed).toBe(false)
  })

  it('has nothing to report when no documents exist yet', () => {
    const r = repairPriceChangeImpact({ previousTotal: 2000, nextTotal: 5000 })
    expect(r.changed).toBe(true)
    expect(r.impacts).toEqual([])
    expect(r.needsAttention).toBe(false)
  })
})

describe('repairPriceChangeImpact — a posted invoice', () => {
  it('calls for a credit note when the job got cheaper', () => {
    // The customer has been billed more than the revised quote says they owe.
    const r = repairPriceChangeImpact({ previousTotal: 4480, nextTotal: 3000, invoice: posted })
    expect(r.impacts).toHaveLength(1)
    expect(r.impacts[0]).toMatchObject({ doc: 'invoice', action: 'needs_credit_note', ref: 'INV/2026/0255' })
    expect(r.impacts[0].detail).toContain('1,480')
    expect(r.needsAttention).toBe(true)
  })

  it('calls for a debit note when the job got more expensive', () => {
    // The extra work is not billed anywhere yet.
    const r = repairPriceChangeImpact({ previousTotal: 4480, nextTotal: 6000, invoice: posted })
    expect(r.impacts[0]).toMatchObject({ action: 'needs_debit_note' })
    expect(r.impacts[0].detail).toContain('1,520')
  })

  it('treats paid the same as posted — payment is not what freezes it', () => {
    const r = repairPriceChangeImpact({ previousTotal: 4480, nextTotal: 3000, invoice: { ref: 'INV/1', status: 'paid' } })
    expect(r.impacts[0].action).toBe('needs_credit_note')
  })

  it('rewrites a draft invoice instead of raising a note', () => {
    const r = repairPriceChangeImpact({ previousTotal: 4480, nextTotal: 3000, invoice: draftInvoice })
    expect(r.impacts[0].action).toBe('updates_automatically')
    expect(r.needsAttention).toBe(false)
  })

  it('ignores a cancelled invoice', () => {
    const r = repairPriceChangeImpact({ previousTotal: 4480, nextTotal: 3000, invoice: { ref: 'INV/1', status: 'cancelled' } })
    expect(r.impacts).toEqual([])
  })
})

describe('repairPriceChangeImpact — the sale order', () => {
  it('updates one still at quotation stage', () => {
    const r = repairPriceChangeImpact({ previousTotal: 2000, nextTotal: 3000, saleOrder: quotationSo })
    expect(r.impacts[0]).toMatchObject({ doc: 'sale_order', action: 'updates_automatically' })
    expect(r.needsAttention).toBe(false)
  })

  it('asks for a new version once it is confirmed', () => {
    const r = repairPriceChangeImpact({ previousTotal: 2000, nextTotal: 3000, saleOrder: confirmedSo })
    expect(r.impacts[0]).toMatchObject({ doc: 'sale_order', action: 'needs_new_version' })
    expect(r.needsAttention).toBe(true)
  })
})

describe('repairPriceChangeImpact — both documents at once', () => {
  it('reports each separately, in document order', () => {
    const r = repairPriceChangeImpact({
      previousTotal: 4480,
      nextTotal: 2000,
      saleOrder: confirmedSo,
      invoice: posted,
    })
    expect(r.impacts.map(i => i.doc)).toEqual(['sale_order', 'invoice'])
    expect(r.impacts.map(i => i.action)).toEqual(['needs_new_version', 'needs_credit_note'])
  })

  it('needs no attention when everything downstream is still editable', () => {
    const r = repairPriceChangeImpact({
      previousTotal: 4480,
      nextTotal: 2000,
      saleOrder: quotationSo,
      invoice: draftInvoice,
    })
    expect(r.needsAttention).toBe(false)
    expect(r.impacts.every(i => i.action === 'updates_automatically')).toBe(true)
  })
})

describe('describeRepairPriceChange', () => {
  it('leads with the direction and lists one line per document', () => {
    const text = describeRepairPriceChange(repairPriceChangeImpact({
      previousTotal: 4480,
      nextTotal: 3000,
      invoice: posted,
    }))
    expect(text).toContain('Quote reduced by KES 1,480.00')
    expect(text).toContain('• INV/2026/0255 is posted')
  })

  it('says nothing when nothing changed', () => {
    expect(describeRepairPriceChange(repairPriceChangeImpact({ previousTotal: 100, nextTotal: 100 }))).toBe('')
  })
})
