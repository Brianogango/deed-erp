import { describe, expect, it } from 'vitest'
import { contactPersonHint, defaultContactPerson } from '@/lib/crm/default-contact-person'

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

describe('contact person prompt', () => {
  const three = [p('a', 'c1'), p('b', 'c1'), p('c', 'c1')]
  it('asks the user to choose when several people are on file', () => {
    expect(contactPersonHint(three, 'c1', '')).toBe('3 contact persons on file — choose who this is for')
  })
  it('stays quiet once someone is chosen or there is nothing to choose', () => {
    expect(contactPersonHint(three, 'c1', 'a')).toBeUndefined()
    expect(contactPersonHint([p('a', 'c1')], 'c1', '')).toBeUndefined()
    expect(contactPersonHint(three, '', '')).toBeUndefined()
  })
})
