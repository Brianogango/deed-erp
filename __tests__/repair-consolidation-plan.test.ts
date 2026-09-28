import { describe, expect, it } from 'vitest'
import { planRepairConsolidation, supersededOrderBlockers } from '@/lib/repair/consolidation-plan'
import { buildRepairInvoiceCharges, repairInvoiceChargeTotal } from '@/lib/repair-invoice'

const repair = (over: Record<string, unknown> = {}) => ({
  id: 'rep-1',
  ref: 'REP/0310',
  productName: 'HP 840 G3',
  clientId: 'client-1',
  saleOrderId: 'so-1',
  status: 'ready',
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

describe('what the workshop has to have finished first', () => {
  it('refuses a repair still in the workshop, and says why', () => {
    // The server invoices a repair order without a delivery note only once
    // the job is Ready. Finding that out after the merged order was written
    // would leave a stray order behind.
    const p = plan([repair(), second({ status: 'in_repair' })])
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.reason).toMatch(/REP\/0311 \(not ready/)
  })

  it('refuses an unrepairable job — its bill is decided on its own', () => {
    const p = plan([repair(), second({ status: 'unrepairable' })])
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.reason).toContain('unrepairable')
  })

  it('refuses a no-charge job', () => {
    const p = plan([repair(), second({ billingExempt: true })])
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.reason).toContain('no-charge')
  })

  it('accepts repairs already released or collected', () => {
    expect(plan([repair({ status: 'collected' }), second({ status: 'verified_released' })]).ok).toBe(true)
  })

  it('refuses the same repair selected twice', () => {
    expect(plan([repair(), repair()]).ok).toBe(false)
  })
})

describe('reading repairs as the store holds them', () => {
  it('takes the client from customerId when clientId is absent', () => {
    const p = plan([
      repair({ clientId: undefined, customerId: 'cust-7' }),
      second({ clientId: undefined, customerId: 'cust-7' }),
    ])
    expect(p.ok && p.clientId).toBe('cust-7')
  })
})

describe('each charge on the merged order', () => {
  const lines = () => {
    const p = plan([repair(), second()])
    if (!p.ok) throw new Error(p.reason)
    return p.lines.filter(l => l.lineType !== 'section')
  }

  it('names its repair, because the headings do not reach the invoice', () => {
    expect(lines().map(l => l.description)).toEqual([
      'REP/0310 · [LABOR] Power issue fix',
      'REP/0311 · [LABOR] Screen replacement',
    ])
  })

  it('bills labour with no catalogue product as a service line', () => {
    expect(lines()[0]).toMatchObject({ unit: 'service', invoicePolicy: 'order', lineType: 'service' })
  })

  it('keeps a catalogue part as a product line', () => {
    const p = plan([repair(), second({
      quote: {
        subtotal: 2000, tax: 320, total: 2320,
        lines: [{ type: 'part', productId: 'prod-9', description: 'Screen', qty: 1, unitPrice: 2000, subtotal: 2000, decision: 'approved' }],
      },
    })])
    if (!p.ok) throw new Error(p.reason)
    const part = p.lines.find(l => l.productId === 'prod-9')
    expect(part).toMatchObject({ qty: 1, unitPrice: 2000, taxRate: 16 })
    expect(part?.invoicePolicy).toBeUndefined()
  })

  it('leaves out a line the customer declined', () => {
    const p = plan([repair(), second({
      quote: {
        subtotal: 5000, tax: 800, total: 5800,
        lines: [
          { type: 'labor', description: 'Screen replacement', qty: 1, unitPrice: 5000, subtotal: 5000, decision: 'approved' },
          { type: 'part', description: 'Keyboard', qty: 1, unitPrice: 1500, subtotal: 1500, decision: 'declined' },
        ],
      },
    })])
    if (!p.ok) throw new Error(p.reason)
    expect(p.lines.some(l => l.description.includes('Keyboard'))).toBe(false)
  })
})

describe('billing together never changes what either repair costs', () => {
  it('totals exactly what the two repairs would have been invoiced separately', () => {
    const a = repair({ diagnosisFee: 1000, diagnosisFeeStatus: 'applicable' })
    const b = second()
    const alone = [a, b].reduce((sum, r) => sum + repairInvoiceChargeTotal(buildRepairInvoiceCharges(r as never)), 0)
    const p = plan([a, b])
    if (!p.ok) throw new Error(p.reason)
    expect(p.total).toBe(alone)
  })
})

describe('retiring the repairs\' own sale orders', () => {
  const orders = [{ id: 'so-1', ref: 'SO/0101', status: 'sale' }, { id: 'so-2', ref: 'SO/0102', status: 'quotation' }]

  it('clears orders with nothing hanging off them', () => {
    expect(supersededOrderBlockers({ orders, invoices: [], deliveries: [] })).toEqual([])
  })

  it('blocks an order that already carries a live invoice, even a draft', () => {
    // A draft is still a bill in progress — cancelling its order and
    // invoicing the merged one would bill the repair twice.
    const blockers = supersededOrderBlockers({
      orders,
      invoices: [{ saleOrderId: 'so-2', status: 'draft', ref: 'INV/0044' }],
      deliveries: [],
    })
    expect(blockers).toEqual(['SO/0102 already has INV/0044'])
  })

  it('ignores cancelled invoices', () => {
    expect(supersededOrderBlockers({
      orders,
      invoices: [{ saleOrderId: 'so-1', status: 'cancelled' }],
      deliveries: [],
    })).toEqual([])
  })

  it('blocks an order with a completed delivery', () => {
    expect(supersededOrderBlockers({
      orders,
      invoices: [],
      deliveries: [{ saleOrderId: 'so-1', status: 'done' }],
    })[0]).toContain('SO/0101')
  })
})
