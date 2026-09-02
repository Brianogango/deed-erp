import { describe, expect, it } from 'vitest'
import { appStateKeysForRoute } from '@/lib/app-state-hydration'

describe('dashboard app-state hydration contract', () => {
  it('hydrates every collection the dashboard reads before rendering KPIs', () => {
    const keys = appStateKeysForRoute('/')

    expect(keys).toEqual(expect.arrayContaining([
      'deed_products',
      'deed_saleOrders',
      'deed_invoices',
      'deed_repairs_v2',
      'deed_expenses',
      'deed_deposits',
      'deed_contacts',
      'deed_accounts',
      'deed_bankAccounts',
      'deed_bankStatementLines',
      'deed_serials',
      'deed_bulkStock',
      'deed_posOrders',
      'deed_purchaseOrders',
      'deed_payrollRuns',
      'deed_stockTransfers',
      'deed_kilimallOrders',
      'deed_outsourceJobs',
      'deed_refurbishmentJobs',
      'deed_journalEntries',
    ]))
  })
})
