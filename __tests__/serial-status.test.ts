import { describe, expect, it } from 'vitest'
import { isOnHandSerialStatus } from '@/lib/inventory/serial-status'

describe('serial status vocabulary', () => {
  it('treats available and in_stock as on-hand', () => {
    expect(isOnHandSerialStatus('available')).toBe(true)
    expect(isOnHandSerialStatus('in_stock')).toBe(true)
    expect(isOnHandSerialStatus('sold')).toBe(false)
  })

  })
