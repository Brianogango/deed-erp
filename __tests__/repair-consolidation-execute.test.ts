import { describe, expect, it } from 'vitest'
import {
  executeRepairConsolidation,
  mergedSaleOrderFromPlan,
  type ConsolidationDeps,
} from '@/lib/repair/consolidation-execute'
import type { ConsolidationPlan } from '@/lib/repair/consolidation-plan'

const plan: Extract<ConsolidationPlan, { ok: true }> = {
  ok: true,
  clientId: 'client-1',
  repairIds: ['rep-1', 'rep-2'],
  repairRefs: ['REP/0310', 'REP/0311'],
  supersededSaleOrderIds: ['so-1', 'so-2'],
  lines: [],
  subtotal: 8000,
  taxTotal: 800,
  total: 8800,
  mixedVat: true,
  notes: 'Consolidated repair billing — REP/0310, REP/0311',
}

const order = mergedSaleOrderFromPlan(plan, {
  id: 'so-merged', ref: 'SO/0200', customerName: 'Acme', now: '2026-09-28T10:00:00Z', date: '2026-09-28',
})

/** Records every write, in order, and fails the ones asked to. */
const harness = (fail: { create?: boolean; invoice?: boolean; cancel?: string[] } = {}) => {
  const log: string[] = []
  const deps: ConsolidationDeps<{ id: string }> = {
    createSaleOrder: async o => {
      log.push(`create ${o.id}`)
      return fail.create ? { ok: false, error: 'create refused' } : { ok: true, id: String(o.id) }
    },
    invoiceSaleOrder: async id => {
      log.push(`invoice ${id}`)
      return fail.invoice
        ? { ok: false, error: 'invoice refused' }
        : { ok: true, invoice: { id: 'inv-1' }, saleOrderId: id }
    },
    cancelSaleOrder: async id => {
      log.push(`cancel ${id}`)
      return fail.cancel?.includes(id) ? { ok: false } : { ok: true }
    },
  }
  return { log, deps }
}

describe('billing several repairs on one invoice', () => {
  it('writes the merged order, invoices it, then retires the old orders', async () => {
    const { log, deps } = harness()
    const out = await executeRepairConsolidation(plan, order, deps)
    expect(out).toMatchObject({ ok: true, saleOrderId: 'so-merged', stillOpenSaleOrderIds: [] })
    expect(log).toEqual(['create so-merged', 'invoice so-merged', 'cancel so-1', 'cancel so-2'])
  })

  it('touches nothing else when the merged order cannot be saved', async () => {
    const { log, deps } = harness({ create: true })
    const out = await executeRepairConsolidation(plan, order, deps)
    expect(out).toMatchObject({ ok: false, error: 'create refused' })
    expect(log).toEqual(['create so-merged'])
  })

  it('withdraws the merged order and keeps the old ones when invoicing fails', async () => {
    // Cancelling the old orders first would leave finished repairs with
    // nothing to bill them from.
    const { log, deps } = harness({ invoice: true })
    const out = await executeRepairConsolidation(plan, order, deps)
    expect(out).toMatchObject({ ok: false, error: 'invoice refused' })
    expect(out.ok === false && out.strandedSaleOrderId).toBeFalsy()
    expect(log).toEqual(['create so-merged', 'invoice so-merged', 'cancel so-merged'])
  })

  it('names a merged order it could not withdraw', async () => {
    const { deps } = harness({ invoice: true, cancel: ['so-merged'] })
    const out = await executeRepairConsolidation(plan, order, deps)
    expect(out.ok === false && out.strandedSaleOrderId).toBe('so-merged')
  })

  it('still succeeds when an old order will not cancel, and names it', async () => {
    // The customer is billed once, on the new invoice. The old order is a
    // leftover to tidy, not a reason to report the billing as failed.
    const { deps } = harness({ cancel: ['so-2'] })
    const out = await executeRepairConsolidation(plan, order, deps)
    expect(out).toMatchObject({ ok: true, stillOpenSaleOrderIds: ['so-2'] })
  })

  it('never cancels the order it has just invoiced', async () => {
    const { log, deps } = harness()
    await executeRepairConsolidation({ ...plan, supersededSaleOrderIds: ['so-1', 'so-merged'] }, order, deps)
    expect(log.filter(l => l === 'cancel so-merged')).toEqual([])
  })
})

describe('the merged order', () => {
  it('is a confirmed order for the client, carrying the plan totals and marker notes', () => {
    expect(order).toMatchObject({
      status: 'sale',
      customerId: 'client-1',
      reserveStock: false,
      total: 8800,
      taxTotal: 800,
      notes: 'Consolidated repair billing — REP/0310, REP/0311',
    })
  })
})
