import { describe, expect, it } from 'vitest'
import {
  buildInboundLeadNotifyContent,
  resolveInboundLeadNotifyRecipients,
} from '@/lib/crm/sales-inbox-notifications'

describe('resolveInboundLeadNotifyRecipients', () => {
  it('emails owner and Ccs sales team when both differ', () => {
    expect(resolveInboundLeadNotifyRecipients({
      ownerEmail: 'joseph@deed.co.ke',
      salesTeamEmail: 'sales@deed.co.ke',
    })).toEqual({ to: 'joseph@deed.co.ke', cc: 'sales@deed.co.ke' })
  })

  it('falls back to sales team when no owner email', () => {
    expect(resolveInboundLeadNotifyRecipients({
      ownerEmail: null,
      salesTeamEmail: 'sales@deed.co.ke',
    })).toEqual({ to: 'sales@deed.co.ke' })
  })

  it('returns null when nothing is configured', () => {
    expect(resolveInboundLeadNotifyRecipients({
      ownerEmail: '',
      salesTeamEmail: null,
    })).toBeNull()
  })
})

describe('buildInboundLeadNotifyContent', () => {
  it('includes lead subject and CRM link', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://erp.example.com'
    const content = buildInboundLeadNotifyContent({
      leadId: 'lead-1',
      leadName: 'Acme RFQ',
      leadEmail: 'buyer@acme.co.ke',
      subject: 'Need 10 ThinkPads',
      snippet: 'Please quote ASAP',
      ownerName: 'Joseph',
    })
    expect(content.subject).toContain('Acme RFQ')
    expect(content.subject).toContain('Need 10 ThinkPads')
    expect(content.text).toContain('Open in CRM: https://erp.example.com/crm?tab=leads')
    expect(content.html).toContain('Open in CRM')
    expect(content.html).toContain('buyer@acme.co.ke')
  })
})
