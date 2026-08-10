import { describe, expect, it } from 'vitest'
import { mergeSerialUpdate } from '@/lib/inventory/serial-update'
import type { SerialNumber } from '@/lib/store'

const base: SerialNumber = {
  id: 's1',
  productId: 'p1',
  serial: 'ABC123',
  barcode: 'ABC123',
  status: 'available',
  location: 'warehouse',
  receivedDate: '2026-01-01',
}

describe('mergeSerialUpdate', () => {
  it('persists assignment status and saleOrderId (SO scan / prepare heal)', () => {
    const next = mergeSerialUpdate(
      base,
      { status: 'assigned', saleOrderId: 'so-1', serial: 'ABC123', barcode: 'ABC123' },
      { serial: 'ABC123', barcode: 'ABC123' },
    )
    expect(next.status).toBe('assigned')
    expect(next.saleOrderId).toBe('so-1')
    expect(next.serial).toBe('ABC123')
  })

  it('clears saleOrderId on release-to-stock', () => {
    const assigned = { ...base, status: 'assigned' as const, saleOrderId: 'so-1' }
    const next = mergeSerialUpdate(
      assigned,
      { status: 'available', saleOrderId: undefined, location: 'shop', serial: 'ABC123' },
      { serial: 'ABC123', barcode: 'ABC123' },
    )
    expect(next.status).toBe('available')
    expect(next.saleOrderId).toBeUndefined()
    expect(next.location).toBe('shop')
  })

  it('preserves status when identity-only edit omits reservation fields', () => {
    const assigned = { ...base, status: 'assigned' as const, saleOrderId: 'so-1' }
    const next = mergeSerialUpdate(
      assigned,
      { serial: 'ABC123', barcode: 'ABC123', specs: '16GB' },
      { serial: 'ABC123', barcode: 'ABC123', specs: '16GB' },
    )
    expect(next.status).toBe('assigned')
    expect(next.saleOrderId).toBe('so-1')
    expect(next.specs).toBe('16GB')
  })
})
