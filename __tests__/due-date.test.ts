import { describe, it, expect } from 'vitest'
import { contactPaymentTermsDays, dueDateFromTerms } from '@/lib/due-date'

describe('dueDateFromTerms', () => {
  it('adds the credit period to the document date', () => {
    expect(dueDateFromTerms('2026-10-01', 30)).toBe('2026-10-31')
    expect(dueDateFromTerms('2026-10-01', 0)).toBe('2026-10-01')
    expect(dueDateFromTerms('2026-12-20', 14)).toBe('2027-01-03')
  })
  it('is empty for a missing or invalid date', () => {
    expect(dueDateFromTerms('', 30)).toBe('')
    expect(dueDateFromTerms('01/10/2026', 30)).toBe('')
  })
})

describe('contactPaymentTermsDays', () => {
  it('uses the contact\'s period, including an explicit 0', () => {
    expect(contactPaymentTermsDays({ paymentTermsDays: 45 }, 30)).toBe(45)
    expect(contactPaymentTermsDays({ paymentTermsDays: 0 }, 30)).toBe(0)
    expect(contactPaymentTermsDays({ paymentTermsDays: '60' }, 30)).toBe(60)
  })
  it('falls back only when none is set', () => {
    expect(contactPaymentTermsDays(undefined, 30)).toBe(30)
    expect(contactPaymentTermsDays({ paymentTermsDays: null }, 14)).toBe(14)
    expect(contactPaymentTermsDays({ paymentTermsDays: -5 }, 14)).toBe(14)
  })
})
