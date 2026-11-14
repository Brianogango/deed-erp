import { describe, expect, it } from 'vitest'
import { isBlockedEventChannel, isOverdueInvoiceEmailPaused } from '@/lib/notifications/outbound-pause'


describe('event-level email blocks', () => {
  it('never emails low stock', () => {
    expect(isBlockedEventChannel('inventory.low_stock', 'email', {})).toBe(true)
    expect(isBlockedEventChannel('inventory.low_stock', 'in_app', {})).toBe(false)
  })

  it('pauses overdue-invoice email by default and resumes on false', () => {
    expect(isOverdueInvoiceEmailPaused({})).toBe(true)
    expect(isBlockedEventChannel('finance.invoice_overdue', 'email', {})).toBe(true)
    const resumed = { NOTIFICATIONS_PAUSE_OVERDUE_INVOICES: 'false' }
    expect(isOverdueInvoiceEmailPaused(resumed)).toBe(false)
    expect(isBlockedEventChannel('finance.invoice_overdue', 'email', resumed)).toBe(false)
    expect(isBlockedEventChannel('finance.invoice_overdue', 'in_app', {})).toBe(false)
  })

  it('leaves other events alone', () => {
    expect(isBlockedEventChannel('director.daily_brief', 'email', {})).toBe(false)
  })
})
