import { describe, expect, it } from 'vitest'
import { canAssignLead, canDeleteLead, canSeeLead, leadListWhere, phoneKey } from '@/lib/crm/lead-access'
import { buildMyWork } from '@/lib/my-work'

describe('lead access', () => {
  it('a rep sees own and unassigned leads only; technicians none', () => {
    expect(canSeeLead('sales_rep', 'u1', { ownerId: 'u1' })).toBe(true)
    expect(canSeeLead('sales_rep', 'u1', { ownerId: null })).toBe(true)
    expect(canSeeLead('sales_rep', 'u1', { ownerId: 'u2' })).toBe(false)
    expect(canSeeLead('technician', 'u1', { ownerId: null })).toBe(false)
    expect(canSeeLead('director', 'u1', { ownerId: 'u2' })).toBe(true)
    expect(leadListWhere('sales_rep', 'u1')).toEqual({ OR: [{ ownerId: 'u1' }, { ownerId: null }] })
    expect(leadListWhere('director', 'u1')).toEqual({})
  })

  it('only managers assign; reps delete only their own unconverted leads', () => {
    expect(canAssignLead('sales_rep')).toBe(false)
    expect(canAssignLead('admin_officer')).toBe(true)
    expect(canDeleteLead('sales_rep', 'u1', { ownerId: 'u1', stage: 'new' })).toBe(true)
    expect(canDeleteLead('sales_rep', 'u1', { ownerId: 'u1', stage: 'converted' })).toBe(false)
    expect(canDeleteLead('sales_rep', 'u1', { ownerId: null, stage: 'new' })).toBe(false)
    expect(canDeleteLead('director', 'u1', { ownerId: 'u2', stage: 'converted' })).toBe(true)
  })

  it('one phone number in its usual spellings', () => {
    expect(phoneKey('0712 345 678')).toBe(phoneKey('+254712345678'))
    expect(phoneKey('712345678')).toBe('712345678')
    expect(phoneKey('123')).toBeNull()
  })
})

describe('my work: CRM queues', () => {
  const base = {
    userId: 'rep', now: new Date('2026-10-18T10:00:00Z'),
    repairs: [], saleOrders: [], invoices: [], deliveries: [], buyBacks: [], stockAdjustments: [], serials: [], purchaseOrders: [],
    invoiceHref: (id: string) => id,
  }
  it('lists due and uncontacted leads, due deal activities and deals with no next step', () => {
    const queues = buildMyWork({
      ...base,
      role: 'sales_rep',
      leads: [
        { id: 'l1', name: 'Due', ownerId: 'rep', stage: 'contacted', nextFollowUpAt: '2026-10-17T00:00:00Z', createdAt: '2026-10-10' },
        { id: 'l2', name: 'Cold new', ownerId: null, stage: 'new', createdAt: '2026-10-15' },
        { id: 'l3', name: 'Later', ownerId: 'rep', stage: 'contacted', nextFollowUpAt: '2026-10-25T00:00:00Z', createdAt: '2026-10-10' },
        { id: 'l4', name: 'Lost', ownerId: 'rep', stage: 'lost', createdAt: '2026-10-01' },
      ],
      opportunities: [
        { id: 'o1', name: 'Printers', ownerId: 'rep', stage: 'proposal', createdAt: '2026-10-01', lastActivityDate: '2026-10-01' },
        { id: 'o2', name: 'Laptops', ownerId: 'rep', stage: 'negotiation', createdAt: '2026-10-01' },
        { id: 'o3', name: 'Someone else', ownerId: 'other', stage: 'proposal', createdAt: '2026-10-01' },
      ],
      opportunityActivities: [
        { id: 'a1', opportunityId: 'o2', status: 'scheduled', scheduledDate: '2026-10-18', subject: 'Call buyer', type: 'call' },
      ],
    })
    const byId = Object.fromEntries(queues.map(q => [q.id, q]))
    expect(byId['crm-leads'].items.map(i => i.id).sort()).toEqual(['l1', 'l2'])
    expect(byId['crm-activities'].items.map(i => i.id)).toEqual(['a1'])
    expect(byId['crm-no-next-step'].items.map(i => i.id)).toEqual(['o1'])
  })
})
