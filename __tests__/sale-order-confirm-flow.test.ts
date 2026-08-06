import { describe, expect, it } from 'vitest'
import { saleOrderLooksConfirmed, isQuotationStage } from '@/lib/odoo-sales-flow'
import { lockVersionMismatch, readExpectedVersion } from '@/lib/optimistic-lock'

describe('sale order confirm durability', () => {
  it('treats SO-numbered quotations as already confirmed', () => {
    expect(saleOrderLooksConfirmed({ status: 'quotation', orderNumber: 'SO/2026/0108' })).toBe(true)
    expect(saleOrderLooksConfirmed({ status: 'quotation_sent', confirmedAt: '2026-08-06' })).toBe(true)
    expect(saleOrderLooksConfirmed({ status: 'quotation', orderNumber: 'QUO/2026/0108' })).toBe(false)
  })

  it('confirm PATCH without lockVersion never mismatches', () => {
    const body = { status: 'sale', orderNumber: 'SO/2026/0099' }
    expect(readExpectedVersion(body)).toBeUndefined()
    expect(lockVersionMismatch(12, readExpectedVersion(body))).toBe(false)
  })

  it('stale lockVersion still mismatches when provided', () => {
    expect(lockVersionMismatch(5, 4)).toBe(true)
    expect(lockVersionMismatch(5, 5)).toBe(false)
  })

  it('UI heal maps drifted confirmed quotations to sale stage', () => {
    const drifted = { status: 'quotation' as const, orderNumber: 'SO/2026/0042', confirmedAt: '2026-08-06T09:00:00Z' }
    const looks = saleOrderLooksConfirmed(drifted)
    const status = looks && isQuotationStage(drifted.status) ? 'sale' : drifted.status
    expect(status).toBe('sale')
  })
})
