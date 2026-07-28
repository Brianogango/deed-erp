import { describe, expect, it } from 'vitest'
import { appStateKeysForRoute } from '@/lib/app-state-hydration'

describe('appStateKeysForRoute', () => {
  it('hydrates KPI Targets and every ledger used by automatic metrics on /sops', () => {
    const keys = appStateKeysForRoute('/sops')
    expect(keys).toEqual(expect.arrayContaining([
      'deed_sops',
      'deed_sopActuals',
      'deed_repairs_v2',
      'deed_expenses',
      'deed_outsourceJobs',
      'deed_saleOrders',
      'deed_leaveRequests',
    ]))
  })

  it('normalizes query strings and trailing slashes for KPI Targets', () => {
    expect(appStateKeysForRoute('/sops/?tab=my#current')).toContain('deed_sops')
  })
})
