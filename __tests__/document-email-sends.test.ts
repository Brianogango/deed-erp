import { describe, expect, it } from 'vitest'
import { parseEmailList } from '@/lib/document-email-sends'

describe('parseEmailList', () => {
  it('splits comma/semicolon/space lists and dedupes', () => {
    expect(parseEmailList('a@deed.co.ke, b@deed.co.ke;c@deed.co.ke a@deed.co.ke')).toEqual([
      'a@deed.co.ke',
      'b@deed.co.ke',
      'c@deed.co.ke',
    ])
  })

  it('accepts arrays and drops invalid tokens', () => {
    expect(parseEmailList(['sales@deed.co.ke', 'not-an-email', 'boss@client.com'])).toEqual([
      'sales@deed.co.ke',
      'boss@client.com',
    ])
  })
})
