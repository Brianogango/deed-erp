import { describe, expect, it } from 'vitest'
import {
  countPurchaseFilterFacets,
  filterPurchaseOrders,
  matchesPurchaseFilters,
  purchaseDocType,
} from '@/lib/purchases-filter'

const sample = [
  { id: '1', status: 'draft' },
  { id: '2', status: 'sent' },
  { id: '3', status: 'confirmed' },
  { id: '4', status: 'partial' },
  { id: '5', status: 'received' },
  { id: '6', status: 'received' },
  { id: '7', status: 'cancelled' },
]

describe('purchaseDocType', () => {
  it('treats draft and sent as RFQ; all other statuses as PO', () => {
    expect(purchaseDocType('draft')).toBe('rfq')
    expect(purchaseDocType('sent')).toBe('rfq')
    expect(purchaseDocType('confirmed')).toBe('po')
    expect(purchaseDocType('partial')).toBe('po')
    expect(purchaseDocType('received')).toBe('po')
    expect(purchaseDocType('cancelled')).toBe('po')
  })
})

describe('filterPurchaseOrders', () => {
  it('applies type and status with AND logic', () => {
    expect(filterPurchaseOrders(sample, 'all', 'all').map(r => r.id)).toEqual(
      sample.map(r => r.id),
    )
    expect(filterPurchaseOrders(sample, 'rfq', 'all').map(r => r.id)).toEqual(['1', '2'])
    expect(filterPurchaseOrders(sample, 'po', 'all').map(r => r.id)).toEqual([
      '3', '4', '5', '6', '7',
    ])
    expect(filterPurchaseOrders(sample, 'po', 'received').map(r => r.id)).toEqual(['5', '6'])
    expect(filterPurchaseOrders(sample, 'rfq', 'received')).toEqual([])
    expect(filterPurchaseOrders(sample, 'all', 'received').map(r => r.id)).toEqual(['5', '6'])
  })

  it('includes received rows when filtering Type=PO (regression for conflated filter)', () => {
    const onlyReceived = [
      { id: 'a', status: 'received' },
      { id: 'b', status: 'received' },
    ]
    expect(filterPurchaseOrders(onlyReceived, 'po', 'all')).toHaveLength(2)
    expect(matchesPurchaseFilters('received', 'po', 'all')).toBe(true)
  })
})

describe('countPurchaseFilterFacets', () => {
  it('counts type options constrained by status filter', () => {
    const counts = countPurchaseFilterFacets(sample, 'all', 'received')
    expect(counts.type).toEqual({ all: 2, rfq: 0, po: 2 })
    expect(counts.status.all).toBe(7)
    expect(counts.status.received).toBe(2)
    expect(counts.status.draft).toBe(1)
  })

  it('counts status options constrained by type filter', () => {
    const counts = countPurchaseFilterFacets(sample, 'po', 'all')
    expect(counts.type.all).toBe(7)
    expect(counts.type.rfq).toBe(2)
    expect(counts.type.po).toBe(5)
    expect(counts.status).toEqual({
      all: 5,
      draft: 0,
      sent: 0,
      confirmed: 1,
      partial: 1,
      received: 2,
      cancelled: 1,
    })
  })

  it('matches visible row count when both facets are set', () => {
    const typeFilter = 'po' as const
    const statusFilter = 'received' as const
    const visible = filterPurchaseOrders(sample, typeFilter, statusFilter)
    const counts = countPurchaseFilterFacets(sample, typeFilter, statusFilter)
    expect(visible).toHaveLength(2)
    expect(counts.type.po).toBe(2)
    expect(counts.status.received).toBe(2)
    expect(counts.type.all).toBe(2)
    expect(counts.status.all).toBe(5)
  })

  it('shows POs count for all-received data (not zero)', () => {
    const onlyReceived = [
      { status: 'received' },
      { status: 'received' },
      { status: 'received' },
    ]
    const counts = countPurchaseFilterFacets(onlyReceived, 'all', 'all')
    expect(counts.type.po).toBe(3)
    expect(counts.type.rfq).toBe(0)
    expect(counts.status.received).toBe(3)
  })
})
