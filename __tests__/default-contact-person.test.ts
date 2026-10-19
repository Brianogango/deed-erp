import { describe, expect, it } from 'vitest'
import { defaultContactPerson } from '@/lib/crm/default-contact-person'

const p = (id: string, companyId: string, isPrimary = false) => ({ id, companyId, clientId: companyId, isPrimary })

describe('default contact person', () => {
  it('picks the only person on file', () => {
    expect(defaultContactPerson([p('a', 'c1'), p('b', 'c2')], 'c1')?.id).toBe('a')
  })
  it('prefers the one marked primary', () => {
    expect(defaultContactPerson([p('a', 'c1'), p('b', 'c1', true)], 'c1')?.id).toBe('b')
  })
  it('does not guess between several people with no primary', () => {
    expect(defaultContactPerson([p('a', 'c1'), p('b', 'c1')], 'c1')).toBeNull()
  })
  it('does not guess between several primaries', () => {
    expect(defaultContactPerson([p('a', 'c1', true), p('b', 'c1', true)], 'c1')).toBeNull()
  })
  it('gives nothing for no company or a company without people', () => {
    expect(defaultContactPerson([p('a', 'c1')], '')).toBeNull()
    expect(defaultContactPerson([p('a', 'c1')], 'c9')).toBeNull()
  })
})
