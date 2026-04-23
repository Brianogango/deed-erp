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

// Modules available to every logged-in user regardless of role
const SELF_SERVICE_MODULES = new Set<ModuleId>(['hr', 'sops', 'expenses', 'my_documents'])

export const hasModuleAccess = (
  user: Pick<PublicUser, 'role' | 'modules'> | null | undefined,
  module: ModuleId,
) => {
  if (!user) return false
  if (SELF_SERVICE_MODULES.has(module)) return true   // always accessible
  if (user.role === 'admin') return true
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
    admin: 'Administrator',
    finance: 'Finance / Accounts',
    lead_tech: 'Lead Technician',
    repair_tech: 'Technician',
    sales_rep: 'Sales Representative',
  }

  if (labels[role]) return labels[role]

  return role
    .split('_')
    .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}
