import { describe, expect, it } from 'vitest'
import {
  draftLeadFromInboundEmail,
  normalizeMessageId,
  organizationStickyKey,
  parseFromIdentity,
  pickRoundRobinOwner,
  pickStickyOwnerFromPriorLeads,
  shouldSkipInboundEmail,
  hydrateEmailContextFromNotes,
} from '@/lib/crm/sales-inbox-leads'
import { resolveSalesImapConfig } from '@/lib/crm/sales-inbox-imap'

describe('shouldSkipInboundEmail', () => {
  const base = {
    messageId: 'abc',
    fromEmail: 'buyer@acme.co.ke',
    fromName: 'Buyer',
    subject: 'Need 10 laptops',
    textBody: 'Quote please',
  }

  it('accepts external sales enquiry', () => {
    expect(shouldSkipInboundEmail(base)).toEqual({ skip: false })
  })

  it('skips internal deed senders', () => {
    expect(shouldSkipInboundEmail({ ...base, fromEmail: 'edwin@deed.co.ke' })).toMatchObject({
      skip: true,
      reason: 'internal_sender',
    })
  })

  it('skips auto-replies and newsletters', () => {
    expect(shouldSkipInboundEmail({ ...base, autoSubmitted: 'auto-replied' }).skip).toBe(true)
    expect(shouldSkipInboundEmail({ ...base, listUnsubscribe: '<http://x>' }).skip).toBe(true)
    expect(shouldSkipInboundEmail({ ...base, subject: 'Out of Office: away' }).skip).toBe(true)
  })
})

describe('parseFromIdentity / draftLeadFromInboundEmail', () => {
  it('derives company from corporate domain', () => {
    expect(parseFromIdentity('Jane Doe', 'jane@acme.co.ke')).toMatchObject({
      name: 'Jane Doe',
      companyName: 'Acme',
    })
  })

  it('builds a lead draft with inbound_email source', () => {
    const draft = draftLeadFromInboundEmail({
      messageId: '<x@y>',
      fromEmail: 'jane@acme.co.ke',
      fromName: 'Jane Doe',
      subject: 'RFQ laptops',
      textBody: 'Please quote 5 units',
      dateIso: '2026-08-10T10:00:00.000Z',
    })
    expect(draft.source).toBe('inbound_email')
    expect(draft.email).toBe('jane@acme.co.ke')
    expect(draft.inboundMessageId).toContain('x@y')
    expect(draft.notes).toContain('RFQ laptops')
    expect(draft.notes).toContain('Please quote 5 units')
    expect(draft.emailSubject).toBe('RFQ laptops')
    expect(draft.emailSnippet).toContain('Please quote 5 units')
    expect(draft.emailBody).toContain('Please quote 5 units')
  })

  it('uses subject as name for generic procurement mailboxes', () => {
    const draft = draftLeadFromInboundEmail({
      messageId: '<z@y>',
      fromEmail: 'procurement@kijabehospital.org',
      fromName: '',
      subject: 'Laptop RFQ — August',
      textBody: 'Kindly quote',
    })
    expect(draft.name).toBe('Laptop RFQ — August')
    expect(draft.companyName).toMatch(/kijabe/i)
  })
})

describe('sticky organization assignment', () => {
  it('keys corporate domains together', () => {
    expect(organizationStickyKey({ email: 'a@acme.co.ke' })).toBe('domain:acme.co.ke')
    expect(organizationStickyKey({ email: 'b@acme.co.ke' })).toBe('domain:acme.co.ke')
    expect(organizationStickyKey({ email: 'person@gmail.com' })).toBe('email:person@gmail.com')
  })

  it('reuses prior owner for same domain', () => {
    const owner = pickStickyOwnerFromPriorLeads(
      [
        { ownerId: 'rep-1', email: 'alice@kijabehospital.org', companyName: 'Kijabe' },
        { ownerId: 'rep-2', email: 'bob@other.org', companyName: 'Other' },
      ],
      { email: 'procurement@kijabehospital.org', companyName: 'Kijabehospital' },
      ['rep-1', 'rep-2'],
    )
    expect(owner).toBe('rep-1')
  })

  it('returns null when no prior org match', () => {
    expect(pickStickyOwnerFromPriorLeads(
      [{ ownerId: 'rep-1', email: 'x@other.org', companyName: 'Other' }],
      { email: 'new@brandnew.co.ke', companyName: 'Brandnew' },
      ['rep-1'],
    )).toBeNull()
  })
})

describe('hydrateEmailContextFromNotes', () => {
  it('pulls subject and body from legacy notes', () => {
    const hydrated = hydrateEmailContextFromNotes(
      'Re: Need quotation\n\nInbound email to sales@deed.co.ke\nSubject: Need quotation\n\nHello team',
    )
    expect(hydrated.emailSubject).toBe('Need quotation')
    expect(hydrated.emailBody).toContain('Hello team')
  })
})

describe('pickRoundRobinOwner', () => {
  it('cycles through sorted sales rep ids', () => {
    const ids = ['b-rep', 'a-rep', 'c-rep']
    const first = pickRoundRobinOwner(ids, null)
    expect(first).toBe('a-rep')
    expect(pickRoundRobinOwner(ids, first)).toBe('b-rep')
    expect(pickRoundRobinOwner(ids, 'b-rep')).toBe('c-rep')
    expect(pickRoundRobinOwner(ids, 'c-rep')).toBe('a-rep')
  })

  it('returns null when no reps', () => {
    expect(pickRoundRobinOwner([])).toBeNull()
  })
})

describe('normalizeMessageId', () => {
  it('strips angle brackets', () => {
    expect(normalizeMessageId('<id@mail>', 'x')).toBe('id@mail')
  })
  it('synthesizes when missing', () => {
    expect(normalizeMessageId('', 'uid:9')).toBe('synthetic:uid:9')
  })
})

describe('resolveSalesImapConfig', () => {
  it('returns null without password', () => {
    expect(resolveSalesImapConfig({
      SALES_EMAIL: 'sales@deed.co.ke',
      SMTP_HOST: 'mail.deed.co.ke',
    } as unknown as NodeJS.ProcessEnv)).toBeNull()
  })

  it('falls back to SALES_SMTP_PASS and SMTP_HOST', () => {
    const cfg = resolveSalesImapConfig({
      SALES_EMAIL: 'sales@deed.co.ke',
      SALES_SMTP_PASS: 'secret',
      SMTP_HOST: 'mail.deed.co.ke',
    } as unknown as NodeJS.ProcessEnv)
    expect(cfg).toMatchObject({
      host: 'mail.deed.co.ke',
      port: 993,
      secure: true,
      user: 'sales@deed.co.ke',
      pass: 'secret',
      mailbox: 'INBOX',
    })
  })
})
