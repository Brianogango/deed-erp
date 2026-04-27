import type { ModuleId, PublicUser } from './types'

export const MODULE_LABELS: Record<ModuleId, string> = {
  dashboard: 'Dashboard',
  sales: 'Sales',
  crm: 'CRM',
  inventory: 'Inventory',
  contacts: 'Contacts',
  purchase: 'Purchase',
  pos: 'Point of Sale',
  repair: 'Repairs',
  refurbishment: 'Refurbishment',
  delivery: 'Delivery',
  ecommerce: 'eCommerce',
  kilimall: 'Kilimall',
  accounting: 'Accounting',
  hr: 'HR',
  outsource: 'Outsource Repairs',
  after_sales: 'After-Sales',
  sops: 'Performance Targets',
  expenses: 'Expenses',
  leave: 'Leave Application',
  my_documents: 'My Documents',
}

// Modules accessible to every logged-in user regardless of role
const SELF_SERVICE_MODULES = new Set<ModuleId>(['hr', 'sops', 'expenses', 'my_documents', 'leave'])

export const hasModuleAccess = (
  user: Pick<PublicUser, 'role' | 'modules'> | null | undefined,
  module: ModuleId,
) => {
  if (!user) return false
  if (SELF_SERVICE_MODULES.has(module)) return true
  if (user.role === 'director') return true   // director sees everything
  return user.modules.includes(module)
}

export const getFirstAllowedModule = (
  user: Pick<PublicUser, 'role' | 'modules'> | null | undefined,
): ModuleId => {
  if (!user) return 'dashboard'
  if (hasModuleAccess(user, 'dashboard')) return 'dashboard'
  return user.modules[0] ?? 'dashboard'
}

export const formatRoleLabel = (role: string | null | undefined) => {
  if (!role) return 'No role'

  const labels: Record<string, string> = {
    director:          'Director',
    admin_officer:     'Admin Officer',
    finance_officer:   'Finance Officer',
    inventory_officer: 'Inventory Officer',
    kilimall_officer:  'Kilimall Officer',
    sales_rep:         'Sales Representative',
    lead_tech:         'Technical Lead',
    technician:        'Technician',
    // legacy aliases kept for display-only backward compat
    admin:             'Administrator',
    finance:           'Finance / Accounts',
    repair_tech:       'Technician',
  }

  if (labels[role]) return labels[role]

  return role
    .split('_')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ')
}

// Convenience role-group helpers used across modules
export const isDirector       = (role?: string | null) => role === 'director'
export const isAdminOfficer   = (role?: string | null) => role === 'admin_officer'
export const isFinanceOfficer = (role?: string | null) => role === 'finance_officer'
export const isLeadTech       = (role?: string | null) => role === 'lead_tech'
export const isTechnician     = (role?: string | null) => role === 'technician'
export const isSalesRep       = (role?: string | null) => role === 'sales_rep'
export const isInventoryOfficer  = (role?: string | null) => role === 'inventory_officer'
export const isKilimallOfficer   = (role?: string | null) => role === 'kilimall_officer'

// Composite checks
export const canManageMoney   = (role?: string | null) => ['director', 'finance_officer'].includes(role ?? '')
export const canManageProcess = (role?: string | null) => ['director', 'admin_officer'].includes(role ?? '')
export const canManageTech    = (role?: string | null) => ['director', 'lead_tech'].includes(role ?? '')
export const isTechRole       = (role?: string | null) => ['lead_tech', 'technician'].includes(role ?? '')
