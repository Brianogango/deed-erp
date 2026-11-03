import { describe, it, expect } from 'vitest'
import { kraPinWarning } from '@/lib/contacts/kra-pin'

describe('kraPinWarning', () => {
  it('accepts valid PINs for the right type, and empty', () => {
    expect(kraPinWarning('A012345678B', 'individual')).toBeNull()
    expect(kraPinWarning(' p051130572w ', 'company')).toBeNull()
    expect(kraPinWarning('', 'company')).toBeNull()
  })
  it('warns on bad format and on the wrong type', () => {
    expect(kraPinWarning('A01234567B', 'individual')).toMatch(/typo/)
    expect(kraPinWarning('P051130572W', 'individual')).toMatch(/companies/)
    expect(kraPinWarning('A012345678B', 'company')).toMatch(/individuals/)
  })
})
