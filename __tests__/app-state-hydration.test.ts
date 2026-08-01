import { describe, it, expect } from 'vitest'
import { appStateKeysForRoute } from '@/lib/app-state-hydration'

describe('appStateKeysForRoute', () => {
  it('always includes common settings keys', () => {
    const keys = appStateKeysForRoute('/sales')
    expect(keys).toEqual(expect.arrayContaining([
      'deed_companySettings',
      'deed_systemSettings',
      'deed_notifications',
      'deed_profileImages',
    ]))
  })

  it('uses longest prefix for nested finance invoice routes', () => {
    const keys = appStateKeysForRoute('/finance/invoices/xyz')
    expect(keys).toContain('deed_saleOrders')
    expect(keys).not.toContain('deed_journalEntries')
  })

  it('hydrates CRM routes', () => {
    const keys = appStateKeysForRoute('/crm')
    expect(keys).toEqual(expect.arrayContaining(['deed_quotes', 'deed_contacts', 'deed_saleOrders']))
  })

  it('keeps the dashboard payload lean (no serials / bulk stock)', () => {
    const keys = appStateKeysForRoute('/')
    expect(keys).toContain('deed_saleOrders')
    expect(keys).not.toContain('deed_serials')
    expect(keys).not.toContain('deed_bulkStock')
    expect(keys).not.toContain('deed_stockReservations')
  })
})
