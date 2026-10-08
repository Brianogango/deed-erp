import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ default: { holdover: { findMany: vi.fn(async () => []) } } }))
vi.mock('@/lib/auth/api', () => ({ getRequiredSession: vi.fn() }))

import { holdoverData, loadScreenHoldovers, toScreenHoldover } from '@/lib/holdover-read-model.server'

const row = (over: Record<string, unknown> = {}) => ({
  id: '0b1c6f8e-1d2a-4c3b-9e8f-112233445566', blobId: 'h-1', ref: 'HOLD/0001',
  customerId: null, customerName: 'Jane', customerPhone: '0700', productId: 'p1', productName: 'Laptop',
  serialId: 's1', serialNumber: 'SN1', deviceCondition: 'good', purpose: 'repair_loaner', status: 'active',
  issuedAt: new Date('2026-10-01T09:00:00Z'), dueAt: new Date('2026-10-10T00:00:00Z'), returnedAt: null,
  returnCondition: null, notes: null, createdBy: 'Ann',
  screenExtras: { accessories: 'charger', linkedRepairRef: 'RPR/1', expectedReturnDate: '2026-10-10', issuedDate: '2026-10-01T09:00:00.000Z' },
  createdAt: new Date('2026-10-01T09:00:00Z'), updatedAt: new Date(),
  ...over,
}) as any

describe('holdovers for the screens, read from the holdovers table', () => {
  it('maps columns to the screen fields and keeps the extras and the screen id', () => {
    expect(toScreenHoldover(row())).toMatchObject({
      id: 'h-1', ref: 'HOLD/0001', clientName: 'Jane', serialNumber: 'SN1', issuedByName: 'Ann',
      accessories: 'charger', linkedRepairRef: 'RPR/1', expectedReturnDate: '2026-10-10', returnedDate: '',
    })
  })

  it('uses the table id when the holdover never had a copy id', () => {
    expect(toScreenHoldover(row({ blobId: null })).id).toBe('0b1c6f8e-1d2a-4c3b-9e8f-112233445566')
  })

  it('a return writes the columns and keeps earlier extras', () => {
    const data = holdoverData(
      { status: 'returned', returnedDate: '2026-10-08T10:00:00.000Z', returnCondition: 'good', returnNotes: 'ok', returnLocation: 'warehouse' },
      { accessories: 'charger' },
    )
    expect(data).toMatchObject({ status: 'returned', returnCondition: 'good', returnedAt: new Date('2026-10-08T10:00:00.000Z') })
    expect(data.screenExtras).toEqual({ accessories: 'charger', returnedDate: '2026-10-08T10:00:00.000Z', returnNotes: 'ok', returnLocation: 'warehouse' })
  })

  it('keeps holdovers only the frozen copy has', async () => {
    const list = await loadScreenHoldovers([{ id: 'h-local', ref: 'HOLD/0099' }])
    expect(list.map(h => h.id)).toEqual(['h-local'])
  })
})
