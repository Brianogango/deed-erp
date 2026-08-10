import { describe, expect, it } from 'vitest'
import {
  classifyInboundEmail,
  parseCsvLowerSet,
  resolveInboxBlocklists,
  triageNoteLine,
} from '@/lib/crm/sales-inbox-relevance'

const base = {
  messageId: 'm1',
  fromEmail: 'buyer@acme.co.ke',
  fromName: 'Buyer',
  subject: 'Need 10 laptops',
  textBody: 'Please quote 10 units of Dell laptops for our office.',
}

describe('classifyInboundEmail', () => {
  it('accepts RFQ-shaped corporate mail', () => {
    const d = classifyInboundEmail(base)
    expect(d.action).toBe('accept')
    if (d.action !== 'skip') {
      expect(d.score).toBeGreaterThanOrEqual(2)
      expect(d.signals).toEqual(expect.arrayContaining(['rfq_language', 'product_mention']))
    }
  })

  it('skips blocked noreply senders', () => {
    expect(classifyInboundEmail({
      ...base,
      fromEmail: 'noreply@vendor.com',
      subject: 'Weekly digest',
      textBody: 'Hello',
    })).toMatchObject({ action: 'skip', reason: 'blocked_local' })
  })

  it('skips promo / webinar content', () => {
    expect(classifyInboundEmail({
      ...base,
      subject: 'Join our SEO webinar this Friday',
      textBody: 'Grow your sales with digital marketing tips',
    }).action).toBe('skip')
  })

  it('skips classic auto-reply noise', () => {
    expect(classifyInboundEmail({
      ...base,
      autoSubmitted: 'auto-replied',
    })).toMatchObject({ action: 'skip', reason: 'auto_submitted' })
  })

  it('queues weak mail for review instead of paging sales', () => {
    const d = classifyInboundEmail({
      messageId: 'm2',
      fromEmail: 'person@gmail.com',
      fromName: 'Person',
      subject: 'Hello',
      textBody: 'Hi',
    })
    expect(d.action).toBe('review')
    if (d.action === 'review') {
      expect(d.reason).toMatch(/no_rfq|weak/)
    }
  })

  it('honours env/domain blocklists', () => {
    expect(classifyInboundEmail({
      ...base,
      fromEmail: 'blast@spammy.example',
      subject: 'Hi',
      textBody: 'Hi',
    }, { blockDomains: ['spammy.example'] })).toMatchObject({
      action: 'skip',
      reason: 'blocked_domain',
    })
  })
})

describe('helpers', () => {
  it('parses csv blocklists', () => {
    expect([...parseCsvLowerSet('a.com, B.COM;c.com')].sort()).toEqual(['a.com', 'b.com', 'c.com'])
  })

  it('merges env blocklists', () => {
    const { blockDomains, blockLocals } = resolveInboxBlocklists({
      SALES_INBOX_BLOCK_DOMAINS: 'bad.example',
      SALES_INBOX_BLOCK_LOCALS: 'jobs',
    } as NodeJS.ProcessEnv)
    expect(blockDomains.has('bad.example')).toBe(true)
    expect(blockLocals.has('jobs')).toBe(true)
    expect(blockLocals.has('noreply')).toBe(true)
  })

  it('builds triage note lines', () => {
    expect(triageNoteLine({
      action: 'review',
      reason: 'no_rfq_signals',
      score: 0,
      signals: [],
    })).toContain('needs review')
  })
})
