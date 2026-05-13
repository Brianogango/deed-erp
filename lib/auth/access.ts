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

export const normalizeClientRole = (role: string | null | undefined) => {
  if (!role) return ''
  if (role === 'super_admin' || role === 'director') return 'admin'
  return role
}

export const hasModuleAccess = (
  user: Pick<PublicUser, 'role' | 'modules'> | null | undefined,
  module: ModuleId,
) => {
  if (!user) return false
  if (SELF_SERVICE_MODULES.has(module)) return true
  if (normalizeClientRole(user.role) === 'admin') return true   // admin sees everything
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
    admin:       'Super Admin',
    super_admin: 'Super Admin',
    director:    'Super Admin',
    finance:     'Finance / Accounts',
    lead_tech:   'Technical Lead',
    repair_tech: 'Technician',
    sales_rep:   'Sales Representative',
  }

  if (labels[role]) return labels[role]

  return role
    .split('_')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ')
}

// Convenience role-group helpers used across modules
export const isAdmin      = (role?: string | null) => normalizeClientRole(role) === 'admin'
export const isFinance    = (role?: string | null) => normalizeClientRole(role) === 'finance'
export const isLeadTech   = (role?: string | null) => normalizeClientRole(role) === 'lead_tech'
export const isRepairTech = (role?: string | null) => normalizeClientRole(role) === 'repair_tech'
export const isSalesRep   = (role?: string | null) => normalizeClientRole(role) === 'sales_rep'

// Composite checks
export const canManageMoney   = (role?: string | null) => ['admin', 'finance'].includes(normalizeClientRole(role))
export const canManageProcess = (role?: string | null) => normalizeClientRole(role) === 'admin'
export const canManageTech    = (role?: string | null) => ['admin', 'lead_tech'].includes(normalizeClientRole(role))
export const isTechRole       = (role?: string | null) => ['lead_tech', 'repair_tech'].includes(normalizeClientRole(role))
