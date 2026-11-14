import { describe, expect, it } from 'vitest'
import { parseCsvLowerSet, resolveInboxBlocklists } from '@/lib/crm/sales-inbox-relevance'



describe('helpers', () => {
  it('parses csv blocklists', () => {
    expect([...parseCsvLowerSet('a.com, B.COM;c.com')].sort()).toEqual(['a.com', 'b.com', 'c.com'])
  })

  it('merges env blocklists', () => {
    const { blockDomains, blockLocals } = resolveInboxBlocklists({
      SALES_INBOX_BLOCK_DOMAINS: 'bad.example',
      SALES_INBOX_BLOCK_LOCALS: 'jobs',
    } as unknown as NodeJS.ProcessEnv)
    expect(blockDomains.has('bad.example')).toBe(true)
    expect(blockLocals.has('jobs')).toBe(true)
    expect(blockLocals.has('noreply')).toBe(true)
  })

  })
