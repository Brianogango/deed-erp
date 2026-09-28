import { describe, expect, it } from 'vitest'
import { planRepairConsolidation } from '@/lib/repair/consolidation-plan'

const repair = (over: Record<string, unknown> = {}) => ({
  id: 'rep-1',
  ref: 'REP/0310',
  productName: 'HP 840 G3',
  clientId: 'client-1',
  saleOrderId: 'so-1',
  intakeDate: '2026-09-24',
  repairPath: 'diagnosis_first' as const,
  diagnosisFeeStatus: 'not_applicable' as const,
  quote: {
    subtotal: 3000, tax: 0, total: 3000,
    lines: [{ type: 'labor', description: 'Power issue fix', qty: 1, unitPrice: 3000, subtotal: 3000, decision: 'approved' }],
  },
  ...over,
})

const second = (over: Record<string, unknown> = {}) => repair({
  id: 'rep-2', ref: 'REP/0311', productName: 'Dell 7490', saleOrderId: 'so-2',
  quote: {
    subtotal: 5000, tax: 800, total: 5800,
    lines: [{ type: 'labor', description: 'Screen replacement', qty: 1, unitPrice: 5000, subtotal: 5000, decision: 'approved' }],
  },
  ...over,
})

const plan = (repairs: unknown[]) => planRepairConsolidation({ repairs: repairs as never })

describe('what the plan refuses', () => {
  it('refuses a single repair — that is just ordinary billing', () => {
    const p = plan([repair()])
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.reason).toContain('at least two')
  })

  it('refuses repairs belonging to different clients', () => {
    // One invoice has one customer; mixing them would bill somebody for
    // another customer's device.
    const p = plan([repair(), second({ clientId: 'client-2' })])
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.reason).toContain('same client')
  })

  it('refuses a repair that is already invoiced, and names it', () => {
    const p = plan([repair(), second({ invoiceId: 'inv-9' })])
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.reason).toContain('REP/0311')
  })

  it('refuses a repair with nothing to bill, and names it', () => {
    const p = plan([repair(), second({ quote: null })])
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.reason).toContain('REP/0311')
  })

  it('refuses a client it cannot identify rather than guessing', () => {
    expect(plan([repair({ clientId: '' }), second({ clientId: '' })]).ok).toBe(false)
  })
})

describe('the merged sale order', () => {
  const p = () => {
    const result = plan([repair(), second()])
    if (!result.ok) throw new Error(result.reason)
    return result
  }

  it('opens each repair with its own section heading', () => {
    expect(p().lines.filter(l => l.lineType === 'section').map(l => l.description))
      .toEqual(['Repair REP/0310 — HP 840 G3', 'Repair REP/0311 — Dell 7490'])
  })

  it('carries each repair line at the VAT it was quoted at', () => {
    const charges = p().lines.filter(l => l.lineType !== 'section')
    expect(charges.map(l => l.taxRate)).toEqual([0, 16])
  })

  it('totals subtotal and tax across the batch', () => {
    expect(p()).toMatchObject({ subtotal: 8000, taxTotal: 800, total: 8800 })
  })

  it('flags a batch mixing taxed and untaxed work', () => {
    expect(p().mixedVat).toBe(true)
  })

  it('names the repairs it covers so they can be linked afterwards', () => {
    expect(p().repairIds).toEqual(['rep-1', 'rep-2'])
    expect(p().repairRefs).toEqual(['REP/0310', 'REP/0311'])
  })

  it('lists the sale orders the merged one supersedes', () => {
    // Each repair already has its own SO. Leaving them open would show the
    // work as still waiting to be invoiced after the customer has been billed.
    expect(p().supersededSaleOrderIds).toEqual(['so-1', 'so-2'])
  })

  it('does not list a sale order twice when repairs already share one', () => {
    const shared = plan([repair(), second({ saleOrderId: 'so-1' })])
    if (!shared.ok) throw new Error(shared.reason)
    expect(shared.supersededSaleOrderIds).toEqual(['so-1'])
  })

  it('copes with a repair that never had a sale order', () => {
    const none = plan([repair({ saleOrderId: undefined }), second()])
    if (!none.ok) throw new Error(none.reason)
    expect(none.supersededSaleOrderIds).toEqual(['so-2'])
  })

  it('writes a note naming every repair on the bill', () => {
    expect(p().notes).toBe('Consolidated repair billing — REP/0310, REP/0311')
  })
})
