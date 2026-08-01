import { describe, it, expect } from 'vitest'
import {
  parseSerialList,
  validateSerialIntakeInput,
  resolveIntakeKind,
  nextIntakeDocumentRef,
} from '@/lib/inventory/serial-intake'

describe('parseSerialList', () => {
  it('splits lines/commas and de-duplicates case-insensitively', () => {
    expect(parseSerialList('LR0AWKL5\nlr0awkl5\nPF1A2B3C, XX99')).toEqual([
      'LR0AWKL5',
      'PF1A2B3C',
      'XX99',
    ])
  })

  it('returns empty for blank input', () => {
    expect(parseSerialList('  \n  ')).toEqual([])
  })
})

describe('validateSerialIntakeInput', () => {
  it('accepts a valid warehouse intake', () => {
    const result = validateSerialIntakeInput({
      productId: 'p1',
      serials: ['AAA', 'BBB'],
      location: 'warehouse',
      reason: 'Opening balance',
      existingSerials: [{ serial: 'CCC' }],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.serials).toEqual(['AAA', 'BBB'])
      expect(result.location).toBe('warehouse')
    }
  })

  it('rejects duplicates against existing stock and bad location', () => {
    const result = validateSerialIntakeInput({
      productId: 'p1',
      serials: ['AAA', 'aaa'],
      location: 'customer',
      reason: '',
      existingSerials: [{ serial: 'AAA' }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some(e => /already exists/i.test(e))).toBe(true)
      expect(result.errors.some(e => /location/i.test(e))).toBe(true)
      expect(result.errors.some(e => /reason/i.test(e))).toBe(true)
    }
  })
})

describe('resolveIntakeKind / nextIntakeDocumentRef', () => {
  it('defaults to opening_balance when opening stock is not posted', () => {
    expect(resolveIntakeKind(false)).toBe('opening_balance')
    expect(resolveIntakeKind(true)).toBe('stock_intake')
    expect(resolveIntakeKind(true, 'opening_balance')).toBe('opening_balance')
  })

  it('increments INTK refs', () => {
    expect(nextIntakeDocumentRef(['OPENING', 'INTK/0002', 'INTK/0009'])).toBe('INTK/0010')
    expect(nextIntakeDocumentRef([])).toBe('INTK/0001')
  })
})
