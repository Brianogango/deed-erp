import { describe, expect, it } from 'vitest'
import { validateOpeningStockInput, validateReceiptInput } from '@/lib/inventory-validation'

describe('validateOpeningStockInput', () => {
  it('accepts valid serialized opening stock lines', () => {
    const result = validateOpeningStockInput(
      [{ productId: 'p1', qty: 2, requiresSerial: true, serials: ['SN-1', 'SN-2'] }],
      [],
    )
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects duplicate existing serials', () => {
    const result = validateOpeningStockInput(
      [{ productId: 'p1', qty: 1, requiresSerial: true, serials: ['SN-1'] }],
      [{ serial: 'SN-1' }],
    )
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('already exists')
  })
})

describe('validateReceiptInput', () => {
  it('requires serial count to match qtyReceived', () => {
    const result = validateReceiptInput(
      [{ productId: 'p1', qtyReceived: 2, requiresSerial: true, serials: ['SN-1'] }],
      [],
    )
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('requires exactly 2 serial number')
  })

  it('allows non-serialized quantity lines', () => {
    const result = validateReceiptInput(
      [{ productId: 'p1', qtyReceived: 5, requiresSerial: false, serials: [] }],
      [],
    )
    expect(result.ok).toBe(true)
  })
})
