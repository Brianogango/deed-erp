import { describe, expect, it } from 'vitest'
import { customerFacingNotes } from '@/lib/customer-facing-notes'

describe('customerFacingNotes', () => {
  it('strips reset-to-draft and auto-created audit lines', () => {
    const raw = [
      'Auto-created from approved repair quote lines: REP-724645',
      'Reset to draft by Brian Ogango for changes.',
      'Reset to draft by Brian Onyango Ogango for changes.',
      'Please deliver before Friday.',
    ].join('\n')
    expect(customerFacingNotes(raw)).toBe('Please deliver before Friday.')
  })

  it('returns empty when only internal lines remain', () => {
    expect(customerFacingNotes('Reset to draft by Finance for changes.\nAuto-created from SO/1')).toBe('')
  })

  it('keeps commercial notes untouched', () => {
    expect(customerFacingNotes('Payment Terms: Net 30\nThanks for your business')).toBe(
      'Payment Terms: Net 30\nThanks for your business',
    )
  })
})
