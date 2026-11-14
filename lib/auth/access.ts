import type { ModuleId, PublicUser, UserRole } from './types'
import { canonicalRole, isDirector } from './roles'

const MODULE_LABELS: Record<ModuleId, string> = {
  dashboard: 'Dashboard',
  sales: 'Sales',
  crm: 'CRM',
  inventory: 'Inventory',
  contacts: 'Contacts',
  purchase: 'Purchase',
  pos: 'Point of Sale',
  repair: 'Repairs',
  refurbishment: 'Refurbishment',
  reconfiguration: 'Device Reconfiguration',
  delivery: 'Delivery',
  ecommerce: 'eCommerce',
  kilimall: 'Kilimall',
  accounting: 'Accounting',
  deposits: 'Deposits & Layby',
  holdovers: 'Device Holdovers',
  company_property: 'Asset Management',
  hr: 'HR Self-Service',
  outsource: 'Outsource Repairs',
  after_sales: 'After-Sales',
  sops: 'KPI Targets',
  sop_documents: 'Standards & SOPs',
  expenses: 'Expenses',
  leave: 'Leave Application',
  my_documents: 'My Documents',
  jarvis: 'DIA — Deed Intelligence Assistant',
}

// Modules accessible to every logged-in user regardless of operational role.
const SELF_SERVICE_MODULES = new Set<ModuleId>(['hr', 'sops', 'sop_documents', 'expenses', 'my_documents', 'leave'])


export const hasModuleAccess = (
  user: Pick<PublicUser, 'role' | 'modules'> | null | undefined,
  module: ModuleId,
) => {
  if (!user) return false
  if (SELF_SERVICE_MODULES.has(module)) return true
  if (canonicalRole(user.role) === 'director') return true
  if (module === 'company_property' && ['admin_officer', 'finance_officer'].includes(canonicalRole(user.role))) return true
  return (user.modules ?? []).includes(module)
}

export const getFirstAllowedModule = (
  user: Pick<PublicUser, 'role' | 'modules'> | null | undefined,
): ModuleId => {
  if (!user) return 'dashboard'
  if (hasModuleAccess(user, 'dashboard')) return 'dashboard'
  return (user.modules ?? [])[0] ?? 'hr'
}

export const formatModuleLabel = (moduleId: string | null | undefined) => {
  if (!moduleId) return 'No module'
  if (moduleId in MODULE_LABELS) return MODULE_LABELS[moduleId as ModuleId]
  return formatRoleLabel(moduleId)
}

export const formatRoleLabel = (role: string | null | undefined) => {
  if (!role) return 'No role'

  const labels: Record<string, string> = {
    super_admin:       'Director',
    admin:             'Director',
    director:          'Director',
    admin_officer:     'Admin Officer',
    finance:           'Finance Officer',
    finance_officer:   'Finance Officer',
    inventory:         'Inventory Officer',
    inventory_officer: 'Inventory Officer',
    kilimall:          'Kilimall Officer',
    kilimall_officer:  'Kilimall Officer',
    sales:             'Sales Rep',
    sales_rep:         'Sales Rep',
    lead_tech:         'Technical Lead',
    technical_lead:    'Technical Lead',
    repair_tech:       'Technician',
    technician:        'Technician',
  }

  if (labels[role]) return labels[role]

  return role
    .split('_')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ')
}

// Convenience role-group helpers used across modules.
// Keep client-side HR controls aligned with the server permission matrix.
// HR and leave decisions belong to the Director and to HR (a custom role
// holding manageHR / approveLeave). Everyone else has self-service only.
export const HR_MANAGER_ROLES: readonly UserRole[] = ['director']
export const LEAVE_APPROVER_ROLES: readonly UserRole[] = ['director']


