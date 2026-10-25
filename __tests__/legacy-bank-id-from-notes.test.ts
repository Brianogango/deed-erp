import { describe, expect, it } from 'vitest'
import { legacyBankIdFromNotes } from '@/lib/accounting/bank-account-ref'

describe('legacy bank id kept in payment notes', () => {
  it('reads the account the payment route wrote', () => {
    expect(legacyBankIdFromNotes('Account: absa')).toBe('absa')
    expect(legacyBankIdFromNotes('Account: absa · idempotency:7f3c')).toBe('absa')
    expect(legacyBankIdFromNotes('Account: tende-9x2k · idempotency:7f3c')).toBe('tende-9x2k')
  })
  it('gives nothing when no account was named', () => {
    expect(legacyBankIdFromNotes('idempotency:7f3c')).toBeNull()
    expect(legacyBankIdFromNotes(null)).toBeNull()
    expect(legacyBankIdFromNotes('Paid via mpesa, Account number follows')).toBeNull()
  })
})
