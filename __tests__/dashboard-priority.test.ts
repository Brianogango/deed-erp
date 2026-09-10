import { describe, it, expect } from 'vitest'
import {
  canShowDashboardKpi,
  dashboardSectionsForRole,
  dashboardSectionsForUser,
  resolveSalesTab,
  resolveSettingsSection,
  visibleDashboardRepairs,
  visibleDashboardRepUsers,
  visibleDashboardSalesOrders,
} from '@/lib/dashboard-priority'
import { ROLE_DEFAULT_MODULES, USER_ROLES } from '@/lib/auth/types'
import { canApproveLeaveRole, canManageHRRole } from '@/lib/auth/access'

describe('dashboardSectionsForRole — role → widget matrix', () => {
  it('director sees organisation-wide sections', () => {
    const s = dashboardSectionsForRole('director')
    expect(s).toMatchObject({
      finance: true, sales: true, salesAnalytics: true, inventory: true,
      inventoryOverview: true, workshop: true, purchasing: true, kilimall: true, hrAdmin: true,
      repairRevenue: true,
    })
  })

  it('finance officer sees money sections but not workshop or HR admin', () => {
    const s = dashboardSectionsForRole('finance_officer')
    expect(s.finance).toBe(true)
    expect(s.sales).toBe(true)
    expect(s.kilimall).toBe(true)
    expect(s.repairRevenue).toBe(true)
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

describe('dashboard role + per-user module gating', () => {
  const user = (role: any, modules: any[], id = 'u1') => ({ id, role, modules })

  it('requires the matching explicit module grant for every privileged section', () => {
    const sections = dashboardSectionsForUser(user('director', ['dashboard', 'sales']))
    expect(sections.sales).toBe(true)
    expect(sections.salesAnalytics).toBe(true)
    expect(sections.finance).toBe(false)
    expect(sections.inventory).toBe(false)
    expect(sections.workshop).toBe(false)
    expect(sections.hrAdmin).toBe(false)
  })

  it('does not let a module grant override the role matrix', () => {
    const sections = dashboardSectionsForUser(user('technician', ['dashboard', 'sales', 'repair', 'accounting']))
    expect(sections.workshop).toBe(true)
    expect(sections.sales).toBe(false)
    expect(sections.finance).toBe(false)
  })

  it('aligns leave approval visibility with all dedicated API approver roles', () => {
    for (const role of ['director', 'admin_officer', 'finance_officer', 'technical_lead']) {
      expect(dashboardSectionsForUser(user(role, ['hr'])).leaveApprovals, role).toBe(true)
    }
    for (const role of ['sales_rep', 'inventory_officer', 'kilimall_officer', 'technician']) {
      expect(dashboardSectionsForUser(user(role, ['hr'])).leaveApprovals, role).toBe(false)
    }
    expect(dashboardSectionsForUser(user('director', ['dashboard'])).leaveApprovals).toBe(false)
  })

  it('shows every sale order on a sales-rep dashboard but still scopes the rep picker', () => {
    const salesRep = user('sales_rep', ['sales'], 'rep-1')
    const orders = [
      { id: 'mine', createdByUserId: 'rep-1' },
      { id: 'other', createdByUserId: 'rep-2' },
      { id: 'assigned', createdByUserId: 'rep-2', salespersonId: 'rep-1' },
    ]
    expect(visibleDashboardSalesOrders(salesRep, orders).map(order => order.id)).toEqual(['mine', 'other', 'assigned'])
    expect(visibleDashboardRepUsers(salesRep, [{ id: 'rep-1' }, { id: 'rep-2' }])).toEqual([{ id: 'rep-1' }])
    expect(visibleDashboardSalesOrders(user('sales_rep', ['dashboard'], 'rep-1'), orders)).toEqual([])
  })

  it('filters a technician repair dashboard to assigned or self-booked work', () => {
    const technician = user('technician', ['repair'], 'tech-1')
    const repairs = [
      { id: 'mine', assignedTechnicianId: 'tech-1' },
      { id: 'booked', createdByUserId: 'tech-1', assignedTechnicianId: 'tech-2' },
      { id: 'other', assignedTechnicianId: 'tech-2' },
      { id: 'unassigned' },
    ]
    expect(visibleDashboardRepairs(technician, repairs).map(repair => repair.id)).toEqual(['mine', 'booked'])
  })

  it('gates P2 KPI cards by their owning module', () => {
    const financeOnly = user('finance_officer', ['accounting'])
    expect(canShowDashboardKpi(financeOnly, 'revenue')).toBe(true)
    expect(canShowDashboardKpi(financeOnly, 'sales')).toBe(false)
    expect(canShowDashboardKpi(financeOnly, 'settlements')).toBe(false)
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

  it('removed tabs (reps moved to dashboard) resolve to the list', () => {
    expect(resolveSalesTab('reps')).toBe('list')
  })

  it('crm deep links resolve to the list (CRM moved fully to /crm)', () => {
    expect(resolveSalesTab('crm')).toBe('list')
    expect(resolveSalesTab('list')).toBe('list')
  })

  it('settings deep-link aliases resolve to real sections', () => {
    expect(resolveSettingsSection('users')).toBe('access')
    expect(resolveSettingsSection('account')).toBe('general')
    expect(resolveSettingsSection('partner_api')).toBe('partner_api')
    expect(resolveSettingsSection('security')).toBe('security')
    expect(resolveSettingsSection('secrets')).toBe('security')
    expect(resolveSettingsSection('env')).toBe('security')
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

describe('HR client/server role alignment', () => {
  it('limits general HR management to director and admin officer', () => {
    expect(canManageHRRole('director')).toBe(true)
    expect(canManageHRRole('admin_officer')).toBe(true)
    expect(canManageHRRole('finance_officer')).toBe(false)
    expect(canManageHRRole('technical_lead')).toBe(false)
  })

  it('keeps leave decisions available to the dedicated API role set', () => {
    expect(USER_ROLES.filter(canApproveLeaveRole)).toEqual([
      'director',
      'admin_officer',
      'finance_officer',
      'technical_lead',
    ])
  })
})
