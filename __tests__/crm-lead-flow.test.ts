import { describe, expect, it } from 'vitest'
import { appendLeadActivity } from '@/lib/crm/lead-activity'
import { opportunityExtras, clientOpportunityId } from '@/lib/opportunity-extras'
import { normalizeOpportunityForClient } from '@/lib/opportunity-normalization'
import { crmEmailHtml } from '@/lib/crm/crm-email'

const rep = { byId: 'u1', byName: 'Jane Rep' }

describe('lead follow-ups', () => {
  it('a call moves a new lead to contacted and sets the next follow-up', () => {
    const next = appendLeadActivity({ stage: 'new', activity: [] }, { ...rep, type: 'call', note: 'Wants 10 laptops', nextFollowUpAt: '2026-10-21' }, new Date('2026-10-18T09:00:00Z'))
    expect(next.stage).toBe('contacted')
    expect(next.lastContactedAt?.toISOString()).toBe('2026-10-18T09:00:00.000Z')
    expect(next.nextFollowUpAt?.toISOString().slice(0, 10)).toBe('2026-10-21')
    expect(next.activity[0]).toMatchObject({ type: 'call', note: 'Wants 10 laptops', byName: 'Jane Rep' })
  })

  it('a note is not contact, and logging without a date clears the reminder', () => {
    const next = appendLeadActivity({ stage: 'new', activity: [{ id: 'a', type: 'call', note: 'x', at: '', byId: '', byName: '' }] }, { ...rep, type: 'note', note: 'Budget approved next month' })
    expect(next.stage).toBeUndefined()
    expect(next.lastContactedAt).toBeUndefined()
    expect(next.nextFollowUpAt).toBeNull()
    expect(next.activity).toHaveLength(2)
  })

  it('does not move a qualified lead backwards', () => {
    expect(appendLeadActivity({ stage: 'qualified' }, { ...rep, type: 'email', note: 'Sent specs' }).stage).toBeUndefined()
  })
})

describe('deal details', () => {
  it('keeps the screen fields and merges edits over what is stored', () => {
    const stored = opportunityExtras({ ref: 'OPP/0004', contactPersonName: 'Ann', leadSource: 'referral', name: 'ignored' })
    expect(stored).toEqual({ ref: 'OPP/0004', contactPersonName: 'Ann', leadSource: 'referral' })
    const merged = opportunityExtras({ lostReason: 'Price', actualValue: 0 }, stored)
    expect(merged).toMatchObject({ ref: 'OPP/0004', contactPersonName: 'Ann', lostReason: 'Price', actualValue: 0 })
  })

  it('reads the stored fields back onto the deal', () => {
    const opp = normalizeOpportunityForClient({
      id: '0f6c2c55-1b7e-4b3d-8a2e-5d8c9e1f2a33', clientId: 'c1', stage: 'proposal', value: '1500', assignedToId: 'u1',
      screenExtras: { ref: 'OPP/0004', contactPersonName: 'Ann', saleOrderIds: ['so1'] },
    })
    expect(opp.ref).toBe('OPP/0004')
    expect(opp.contactPersonName).toBe('Ann')
    expect(opp.saleOrderIds).toEqual(['so1'])
    expect(opp.screenExtras).toBeUndefined()
    expect(opp.expectedValue).toBe(1500)
  })

  it('keeps only a real uuid as the browser id', () => {
    expect(clientOpportunityId({ id: '0f6c2c55-1b7e-4b3d-8a2e-5d8c9e1f2a33' })).toBe('0f6c2c55-1b7e-4b3d-8a2e-5d8c9e1f2a33')
    expect(clientOpportunityId({ id: 'opp-1' })).toBeUndefined()
  })
})

describe('crm email', () => {
  it('escapes the rep\'s text and signs it', () => {
    const html = crmEmailHtml('Hello <b>there</b>\n\nRegards', { name: 'Jane Rep', email: 'jane@deed.co.ke' })
    expect(html).toContain('Hello &lt;b&gt;there&lt;/b&gt;')
    expect(html).toContain('Jane Rep')
    expect(html).toContain('mailto:jane@deed.co.ke')
  })
})
