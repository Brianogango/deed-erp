import { describe, it, expect } from 'vitest'
import { dashboardSectionsForRole, resolveSalesTab, resolveSettingsSection } from '@/lib/dashboard-priority'
import { ROLE_DEFAULT_MODULES, USER_ROLES } from '@/lib/auth/types'

describe('dashboardSectionsForRole — role → widget matrix', () => {
  it('director sees organisation-wide sections', () => {
    const s = dashboardSectionsForRole('director')
    expect(s).toMatchObject({
      finance: true, sales: true, salesAnalytics: true, inventory: true,
      inventoryOverview: true, workshop: true, purchasing: true, kilimall: true, hrAdmin: true,
    })
  })

  it('finance officer sees money sections but not workshop or HR admin', () => {
    const s = dashboardSectionsForRole('finance_officer')
    expect(s.finance).toBe(true)
    expect(s.sales).toBe(true)
    expect(s.kilimall).toBe(true)
    expect(s.workshop).toBe(false)
    expect(s.hrAdmin).toBe(false)
  })

  it('sales rep sees sales sections and never finance/inventory/workshop', () => {
    const s = dashboardSectionsForRole('sales_rep')
    expect(s.sales).toBe(true)
    expect(s.salesAnalytics).toBe(true)
    expect(s.finance).toBe(false)
    expect(s.inventory).toBe(false)
    expect(s.workshop).toBe(false)
    expect(s.purchasing).toBe(false)
    expect(s.kilimall).toBe(false)
    expect(s.hrAdmin).toBe(false)
  })

  it('technician sees only the workshop', () => {
    const s = dashboardSectionsForRole('technician')
    expect(s.workshop).toBe(true)
    expect(s.finance).toBe(false)
    expect(s.sales).toBe(false)
    expect(s.inventory).toBe(false)
    expect(s.kilimall).toBe(false)
    expect(s.repairRevenue).toBe(false)
  })

  it('technical lead sees workshop, inventory, and the repair revenue trend — not finance', () => {
    const s = dashboardSectionsForRole('technical_lead')
    expect(s.workshop).toBe(true)
    expect(s.inventory).toBe(true)
    expect(s.repairRevenue).toBe(true)
    expect(s.finance).toBe(false)
    expect(s.sales).toBe(false)
  })

  it('inventory officer sees stock and purchasing, but not the value-based overview', () => {
    const s = dashboardSectionsForRole('inventory_officer')
    expect(s.inventory).toBe(true)
    expect(s.purchasing).toBe(true)
    expect(s.inventoryOverview).toBe(false)
    expect(s.finance).toBe(false)
  })

  it('kilimall officer sees marketplace and stock, not finance or the value overview', () => {
    const s = dashboardSectionsForRole('kilimall_officer')
    expect(s.kilimall).toBe(true)
    expect(s.inventory).toBe(true)
    expect(s.inventoryOverview).toBe(false)
    expect(s.finance).toBe(false)
  })

  it('unknown/missing roles see nothing privileged', () => {
    for (const role of [null, undefined, '', 'made_up_role']) {
      const s = dashboardSectionsForRole(role as any)
      expect(Object.values(s).every(v => v === false)).toBe(true)
    }
  })
})

describe('module landing behaviour', () => {
  it('legacy sales ?tab=dashboard deep links resolve to the operational list', () => {
    expect(resolveSalesTab('dashboard')).toBe('list')
  })

  it('missing or unknown sales tabs land on the list', () => {
    expect(resolveSalesTab(null)).toBe('list')
    expect(resolveSalesTab(undefined)).toBe('list')
    expect(resolveSalesTab('nonsense')).toBe('list')
  })

  it('valid operational sales tabs are preserved', () => {
    expect(resolveSalesTab('crm')).toBe('crm')
    expect(resolveSalesTab('reps')).toBe('reps')
    expect(resolveSalesTab('after_sales')).toBe('after_sales')
    expect(resolveSalesTab('list')).toBe('list')
  })

  it('settings deep-link aliases resolve to real sections', () => {
    expect(resolveSettingsSection('users')).toBe('access')
    expect(resolveSettingsSection('account')).toBe('general')
    expect(resolveSettingsSection('partner_api')).toBe('partner_api')
    expect(resolveSettingsSection('security')).toBe('security')
    expect(resolveSettingsSection(null)).toBe('general')
    expect(resolveSettingsSection('bogus')).toBe('general')
  })
})

describe('navigation defaults', () => {
  it('every role lands on the central dashboard by default', () => {
    for (const role of USER_ROLES) {
      expect(ROLE_DEFAULT_MODULES[role], `role ${role} must include dashboard`).toContain('dashboard')
    }
  })
})
