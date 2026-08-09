import { describe, expect, it } from 'vitest'
import {
  blobSerialStatusFromPrisma,
  isOnHandSerialStatus,
  prismaSerialStatusFromBlob,
} from '@/lib/inventory/serial-status'

describe('serial status vocabulary', () => {
  it('treats available and in_stock as on-hand', () => {
    expect(isOnHandSerialStatus('available')).toBe(true)
    expect(isOnHandSerialStatus('in_stock')).toBe(true)
    expect(isOnHandSerialStatus('sold')).toBe(false)
  })

  it('maps blob ↔ prisma', () => {
    expect(prismaSerialStatusFromBlob('available')).toBe('in_stock')
    expect(blobSerialStatusFromPrisma('in_stock')).toBe('available')
    expect(prismaSerialStatusFromBlob('refurbishment')).toBe('refurbishing')
  })
})
