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

  it('hydrates CRM routes with CRM entities plus SaleOrders (not full stock catalogs)', () => {
    const keys = appStateKeysForRoute('/crm')
    expect(keys).toEqual(expect.arrayContaining([
      'deed_quotes',
      'deed_contacts',
      'deed_companies',
      'deed_opportunities',
      // Needed so an opportunity's detail view can show the client's real
      // Sales module quotations/orders — CRM's own deed_quotes are rarely
      // populated since "New quotation" in Sales creates a SaleOrder, not
      // a Quote (see components/crm/OpportunityDetail.tsx).
      'deed_saleOrders',
    ]))
    expect(keys).not.toContain('deed_products')
  })

  it('keeps the dashboard payload lean (no serials / bulk stock / workshop extras)', () => {
    const keys = appStateKeysForRoute('/')
    expect(keys).toContain('deed_saleOrders')
    expect(keys).not.toContain('deed_serials')
    expect(keys).not.toContain('deed_bulkStock')
    expect(keys).not.toContain('deed_stockReservations')
    expect(keys).not.toContain('deed_outboundReleases')
    expect(keys).not.toContain('deed_bankStatementLines')
    expect(keys).not.toContain('deed_purchaseOrders')
    expect(keys).not.toContain('deed_stockTransfers')
    expect(keys).not.toContain('deed_posOrders')
  })
})
