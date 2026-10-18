import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { buildCrmReport, firstResponseHours } from '@/lib/crm/crm-report'
import { mapColumns, parseLeadRows } from '@/lib/crm/lead-import'
import { filterStoreValueForRole } from '@/lib/auth/authorization'

const from = new Date('2026-10-01T00:00:00Z')
const to = new Date('2026-10-31T23:59:59Z')

describe('crm report', () => {
  it('measures first response from arrival to the first real contact', () => {
    expect(firstResponseHours({ id: 'l', stage: 'contacted', createdAt: '2026-10-01T08:00:00Z',
      activity: [{ type: 'note', at: '2026-10-01T08:30:00Z' }, { type: 'call', at: '2026-10-01T10:00:00Z' }] })).toBe(2)
    expect(firstResponseHours({ id: 'l', stage: 'new', createdAt: '2026-10-01T08:00:00Z', activity: [{ type: 'note', at: '2026-10-01T09:00:00Z' }] })).toBeNull()
  })

  it('conversion, win rate, lost reasons and the per-rep table', () => {
    const r = buildCrmReport({
      from, to, reps: [{ id: 'a', name: 'Ann' }],
      leads: [
        { id: '1', stage: 'converted', ownerId: 'a', source: 'referral', createdAt: '2026-10-02T08:00:00Z', activity: [{ type: 'call', at: '2026-10-02T09:00:00Z' }] },
        { id: '2', stage: 'lost', ownerId: 'a', source: 'referral', createdAt: '2026-10-03T08:00:00Z', activity: [{ type: 'note', note: 'Marked lost: Price too high', at: '2026-10-05T08:00:00Z' }, { type: 'call', at: '2026-10-04T08:00:00Z' }] },
        { id: '3', stage: 'new', ownerId: null, source: 'website', createdAt: '2026-10-04T08:00:00Z' },
        { id: 'old', stage: 'new', ownerId: 'a', createdAt: '2026-09-01T08:00:00Z' },
      ],
      deals: [
        { id: 'd1', stage: 'closed_won', value: 1000, assignedToId: 'a', createdAt: '2026-10-01T00:00:00Z', screenExtras: { actualValue: 1200, actualCloseDate: '2026-10-11' } },
        { id: 'd2', stage: 'closed_lost', value: 500, assignedToId: 'a', createdAt: '2026-10-01T00:00:00Z', screenExtras: { actualCloseDate: '2026-10-12', lostReason: 'price too high.' } },
        { id: 'd3', stage: 'proposal', value: 800, assignedToId: 'a', createdAt: '2026-10-01T00:00:00Z' },
      ],
    })
    expect(r.leads.created).toBe(3)
    expect(r.leads.conversionRate).toBe(33.3)
    expect(r.leads.neverContacted).toBe(1)
    expect(r.leads.lostReasons).toEqual([{ reason: 'Price too high', count: 1 }])
    expect(r.deals).toMatchObject({ won: 1, lost: 1, wonValue: 1200, winRate: 50, openValue: 800, medianDaysToClose: 10 })
    expect(r.deals.lostReasons[0].count).toBe(1)
    const ann = r.byRep.find(x => x.id === 'a')!
    expect(ann).toMatchObject({ name: 'Ann', leads: 2, converted: 1, dealsWon: 1, winRate: 50, medianFirstResponseHours: 12.5 })
  })
})

describe('lead import', () => {
  it('matches loose headers and checks each row', () => {
    expect(mapColumns(['Contact Person', 'Organisation', 'Mobile No.', 'E-mail', 'Remarks'])).toEqual({ name: 'Contact Person', companyName: 'Organisation', phone: 'Mobile No.', email: 'E-mail', notes: 'Remarks' })
    const { leads, problems } = parseLeadRows([
      { Name: 'Ann Wanjiku', Company: 'Acme', Phone: '712345678', Email: '' },
      { Name: '', Company: 'Beta Ltd', Phone: '', Email: 'info@beta.co.ke' },
      { Name: 'No Contact', Company: '', Phone: '', Email: '' },
      { Name: 'Bad Mail', Company: '', Phone: '', Email: 'not-an-email' },
      { Name: 'Ann again', Company: '', Phone: '+254 712 345 678', Email: '' },
      { Name: '', Company: '', Phone: '', Email: '' },
    ])
    expect(leads.map(l => [l.name, l.phone])).toEqual([['Ann Wanjiku', '0712345678'], ['Beta Ltd', '']])
    expect(problems.map(p => p.row)).toEqual([4, 5, 6])
  })
})

describe('deal activity privacy', () => {
  it('a rep receives only activities on their own deals', () => {
    const rows = [
      { id: '1', createdById: 'x', dealAssignedToId: 'rep' },
      { id: '2', createdById: 'rep', dealAssignedToId: 'other' },
      { id: '3', createdById: 'x', dealAssignedToId: 'other', dealCreatedById: 'other' },
    ]
    const repView = filterStoreValueForRole({ id: 'rep', role: 'sales_rep' } as any, 'deed_oppActivities', rows) as any[]
    expect(repView.map(r => r.id)).toEqual(['1', '2'])
    expect((filterStoreValueForRole({ id: 'd', role: 'director' } as any, 'deed_oppActivities', rows) as any[]).length).toBe(3)
  })
})
