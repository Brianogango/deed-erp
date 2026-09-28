import { describe, expect, it } from 'vitest'
import { consolidationCandidates } from '@/lib/repair/consolidated-invoice'

const job = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  ref: `REP/0${id}`,
  customerId: 'cust-1',
  status: 'ready',
  quote: { subtotal: 1000, tax: 0, total: 1000, lines: [{ type: 'labor', description: 'Fix', qty: 1, unitPrice: 1000, subtotal: 1000 }] },
  ...over,
})

describe('which repairs the combined-billing dialog offers', () => {
  const anchor = job('300')
  const all = [
    job('301', { status: 'in_repair' }),
    job('302'),
    anchor,
    job('303', { customerId: 'cust-2' }),
    job('304', { invoiceId: 'inv-1' }),
    job('305', { status: 'cancelled' }),
  ]
  const offered = () => consolidationCandidates(all, anchor)

  it('lists only this client\'s unbilled, open jobs', () => {
    expect(offered().map(c => c.repair.id).sort()).toEqual(['300', '301', '302'])
  })

  it('puts the repair being viewed first, then the billable ones', () => {
    expect(offered().map(c => c.repair.id)).toEqual(['300', '302', '301'])
  })

  it('shows a job still on the bench, with the reason it cannot be picked', () => {
    expect(offered().find(c => c.repair.id === '301')?.blocker).toContain('not ready')
  })

  it('offers nothing when the client is unknown', () => {
    expect(consolidationCandidates(all, job('306', { customerId: '' }))).toEqual([])
  })
})
