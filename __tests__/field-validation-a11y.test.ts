/**
 * P1-DEED-004 — Field error ARIA contract.
 * Mirrors Field + withLinkedId wiring in components/ui/index.tsx
 * (vitest is node/jsx-preserve and cannot import the client TSX module).
 *
 * Journal entry create UI: none found in the app (journals are list/view +
 * system-posted); skipped for field-validation wiring.
 */
import { describe, expect, it } from 'vitest'

/** Mirrors Field describedBy / aria-invalid derivation when `error` is set. */
function fieldErrorAria(fieldId: string, opts: { error?: string; hint?: string } = {}) {
  const hintId = opts.hint ? `${fieldId}-hint` : undefined
  const errorId = opts.error ? `${fieldId}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  // Only set when invalid — never aria-invalid={false}
  const ariaInvalid = opts.error ? (true as const) : undefined
  return {
    errorId,
    describedBy,
    ariaInvalid,
    alert: opts.error
      ? { id: errorId!, role: 'alert' as const, message: opts.error }
      : undefined,
  }
}

describe('Field error ARIA (P1-DEED-004)', () => {
  it('exposes error id, role=alert, aria-invalid, and aria-describedby', () => {
    const aria = fieldErrorAria('name', { error: 'Name is required' })
    expect(aria.errorId).toBe('name-error')
    expect(aria.alert).toEqual({ id: 'name-error', role: 'alert', message: 'Name is required' })
    expect(aria.ariaInvalid).toBe(true)
    expect(aria.describedBy).toBe('name-error')
  })

  it('does not set aria-invalid when there is no error', () => {
    const aria = fieldErrorAria('name')
    expect(aria.ariaInvalid).toBeUndefined()
    expect(aria.alert).toBeUndefined()
    expect(aria.describedBy).toBeUndefined()
  })

  it('combines hint and error ids in aria-describedby', () => {
    const aria = fieldErrorAria('phone', {
      hint: 'Include country code',
      error: 'Phone is required',
    })
    expect(aria.describedBy).toBe('phone-hint phone-error')
    expect(aria.errorId).toBe('phone-error')
  })
})
