import { describe, it, expect } from 'vitest'
import { appStateKeysForRoute } from '@/lib/app-state-hydration'

describe('appStateKeysForRoute', () => {
  it('always includes common settings keys', () => {
    const keys = appStateKeysForRoute('/sales')
    // Notifications moved to the relational platform — no longer a blob key.
    expect(keys).toEqual(expect.arrayContaining([
      'deed_companySettings',
      'deed_systemSettings',
      'deed_profileImages',
    ]))
  })

  it('uses longest prefix for nested finance invoice routes', () => {
    const keys = appStateKeysForRoute('/finance/invoices/xyz')
    expect(keys).toContain('deed_saleOrders')
    expect(keys).toContain('deed_deliveryJobs')
    expect(keys).toContain('deed_riders')
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

  it('hydrates customer store credit on contacts, finance, sales, and POS', () => {
    expect(appStateKeysForRoute('/contacts')).toContain('deed_customerCredits')
    expect(appStateKeysForRoute('/finance')).toContain('deed_customerCredits')
    expect(appStateKeysForRoute('/finance/invoices/xyz')).toContain('deed_customerCredits')
    expect(appStateKeysForRoute('/sales')).toContain('deed_customerCredits')
    expect(appStateKeysForRoute('/pos')).toContain('deed_customerCredits')
    expect(appStateKeysForRoute('/crm')).toContain('deed_customerCredits')
  })

  it('loads stock moves on the till so restored receipts can resolve serials', () => {
    const keys = appStateKeysForRoute('/pos')
    expect(keys).toEqual(expect.arrayContaining([
      'deed_posOrders',
      'deed_serials',
      'deed_stockMoves',
    ]))
  })

  it('keeps the dashboard payload aligned with Operations / Finance KPI inputs', () => {
    const keys = appStateKeysForRoute('/')
    expect(keys).toEqual(expect.arrayContaining([
      'deed_saleOrders',
      'deed_serials',
      'deed_bulkStock',
      'deed_posOrders',
      'deed_purchaseOrders',
      'deed_payrollRuns',
      // Dashboard reads these collections on first paint — omitting them
      // leaves a stale local cache in place after a deploy.
      'deed_bankStatementLines',
      'deed_stockTransfers',
      'deed_kilimallOrders',
      'deed_outsourceJobs',
      'deed_refurbishmentJobs',
      'deed_journalEntries',
    ]))
    expect(keys).not.toContain('deed_stockReservations')
    expect(keys).not.toContain('deed_outboundReleases')
  })

  it('hydrates stock moves on operations and inventory', () => {
    expect(appStateKeysForRoute('/operations')).toContain('deed_stockMoves')
    expect(appStateKeysForRoute('/inventory')).toContain('deed_stockMoves')
  })

  it('hydrates the company property register and COA on /property', () => {
    const keys = appStateKeysForRoute('/property')
    expect(keys).toEqual(expect.arrayContaining([
      'deed_companyAssets',
      'deed_accounts',
      'deed_companySettings',
    ]))
    expect(keys).not.toContain('deed_employeeAssets')
    expect(keys).not.toContain('deed_products')
  })
})
