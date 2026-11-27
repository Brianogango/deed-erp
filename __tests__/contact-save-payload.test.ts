import { describe, expect, it } from 'vitest'
import { contactSavePayload } from '@/lib/contacts/contact-save-payload'

// Payment details typed for an individual vendor were dropped on save while
// the screen still said "Contact updated".
const opts = { canSetCreditTerms: true, creditLimit: 0 }

describe('contactSavePayload', () => {
  it('keeps an individual vendor’s M-Pesa details', () => {
    const p = contactSavePayload({ name: ' John Fundi ', type: 'individual', isVendor: true, bankName: 'M-Pesa Till', bankAccount: '5123456', bankBranch: '', tradingName: 'x' }, opts)
    expect(p).toMatchObject({ name: 'John Fundi', bankName: 'M-Pesa Till', bankAccount: '5123456' })
    expect(p.tradingName).toBeUndefined()
  })

  it('keeps a company vendor’s bank details and drops person-only fields', () => {
    const p = contactSavePayload({ name: 'Acme', type: 'company', isVendor: true, bankName: 'Equity Bank', bankBranch: 'Moi Avenue', bankAccount: '0170291234567', idNumber: '123' }, opts)
    expect(p).toMatchObject({ bankName: 'Equity Bank', bankBranch: 'Moi Avenue', bankAccount: '0170291234567' })
    expect(p.idNumber).toBeUndefined()
  })
})
