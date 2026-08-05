import { describe, it, expect } from 'vitest'
import {
  isDocumentDateFiscalLocked,
  fiscalLockConflictMessage,
  toFiscalDay,
} from '@/lib/finance-controls'

describe('fiscal lock helpers (AGENT-BE-002)', () => {
  it('does not lock when no lock date is set', () => {
    expect(isDocumentDateFiscalLocked('2026-01-15', null)).toBe(false)
    expect(isDocumentDateFiscalLocked('2026-01-15', undefined)).toBe(false)
  })

  it('blocks dates on or before the lock date', () => {
    expect(isDocumentDateFiscalLocked('2026-03-31', '2026-03-31')).toBe(true)
    expect(isDocumentDateFiscalLocked('2026-03-01', '2026-03-31')).toBe(true)
    expect(isDocumentDateFiscalLocked(new Date('2026-03-15T12:00:00Z'), '2026-03-31')).toBe(true)
  })

  it('allows dates after the lock date', () => {
    expect(isDocumentDateFiscalLocked('2026-04-01', '2026-03-31')).toBe(false)
    expect(isDocumentDateFiscalLocked('2026-12-31', '2026-03-31')).toBe(false)
  })

  it('formats a clear conflict message', () => {
    expect(fiscalLockConflictMessage('2026-03-31')).toContain('2026-03-31')
    expect(fiscalLockConflictMessage('2026-03-31')).toMatch(/locked/i)
  })

  it('normalizes date-only strings to UTC days', () => {
    expect(toFiscalDay('2026-03-31')).toBe('2026-03-31')
  })
})
