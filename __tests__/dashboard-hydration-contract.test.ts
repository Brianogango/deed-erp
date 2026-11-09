import { describe, expect, it } from 'vitest'
import { appStateKeysForRoute } from '@/lib/app-state-hydration'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('dashboard app-state hydration contract', () => {
  it('hydrates every collection the dashboard reads before rendering KPIs', () => {
    const keys = appStateKeysForRoute('/')

    expect(keys).toEqual(expect.arrayContaining([
      'deed_products',
      'deed_repairs_v2',
      'deed_expenses',
      'deed_deposits',
      'deed_contacts',
      'deed_accounts',
      'deed_serials',
      'deed_bulkStock',
      'deed_posOrders',
      'deed_purchaseOrders',
      'deed_payrollRuns',
      'deed_stockTransfers',
      'deed_kilimallOrders',
      'deed_outsourceJobs',
      'deed_refurbishmentJobs',
    ]))
  })

  it('reads invoice-based figures from the server instead of the invoice list', () => {
    const keys = appStateKeysForRoute('/')
    for (const key of ['deed_invoices', 'deed_saleOrders', 'deed_journalEntries', 'deed_bankAccounts', 'deed_bankStatementLines']) {
      expect(keys).not.toContain(key)
    }
    const dashboard = readFileSync(join(process.cwd(), 'components/modules/Dashboard.tsx'), 'utf8')
    expect(dashboard).toContain('/api/dashboard/invoice-figures')
    expect(dashboard).toContain('useDashboardSaleOrders()')
  })

  it('exports useStoreHydrated because Dashboard gates KPIs on it', () => {
    const store = readFileSync(join(process.cwd(), 'lib/store.tsx'), 'utf8')
    expect(store).toMatch(/export function useStoreHydrated\(\)/)
  })
})
