import { describe, it, expect } from 'vitest'
import { reservedQtyElsewhere } from '@/lib/sales-approvals'


describe('backorder stock check excludes self-reservation', () => {
  it('counts other reservations but not this document', () => {
    const reservations = [
      { productId: 'elite', status: 'reserved', qty: 1, referenceId: 'so-self' },
      { productId: 'elite', status: 'reserved', qty: 1, referenceId: 'so-other' },
    ]
    expect(reservedQtyElsewhere(reservations, 'elite', 'so-self')).toBe(1)
    expect(reservedQtyElsewhere(reservations, 'elite')).toBe(2)
  })

  
  
  })
