import type { ModuleId, PublicUser, UserRole } from './types'

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
  deposits: 'Deposits & Layby',
  holdovers: 'Device Holdovers',
  hr: 'HR Self-Service',
  outsource: 'Outsource Repairs',
  after_sales: 'After-Sales',
  sops: 'KPI Targets',
  sop_documents: 'Standards & SOPs',
  expenses: 'Expenses',
  leave: 'Leave Application',
  my_documents: 'My Documents',
  jarvis: 'JARVIS AI Assistant',
}

// Modules accessible to every logged-in user regardless of operational role.
const SELF_SERVICE_MODULES = new Set<ModuleId>(['hr', 'sops', 'sop_documents', 'expenses', 'my_documents', 'leave'])

export const normalizeClientRole = (role: string | null | undefined) => {
  if (!role) return ''
  const aliases: Record<string, string> = {
    super_admin: 'director',
    admin: 'director',
    director: 'director',
    admin_officer: 'admin_officer',
    finance: 'finance_officer',
    finance_officer: 'finance_officer',
    inventory: 'inventory_officer',
    inventory_officer: 'inventory_officer',
    kilimall: 'kilimall_officer',
    kilimall_officer: 'kilimall_officer',
    sales: 'sales_rep',
    sales_rep: 'sales_rep',
    lead_tech: 'technical_lead',
    technical_lead: 'technical_lead',
    repair_tech: 'technician',
    technician: 'technician',
  }
  return aliases[role] ?? role
}

export const hasModuleAccess = (
  user: Pick<PublicUser, 'role' | 'modules'> | null | undefined,
  module: ModuleId,
) => {
  if (!user) return false
  if (SELF_SERVICE_MODULES.has(module)) return true
  if (normalizeClientRole(user.role) === 'director') return true
  return (user.modules ?? []).includes(module)
}

export const getFirstAllowedModule = (
  user: Pick<PublicUser, 'role' | 'modules'> | null | undefined,
): ModuleId => {
  if (!user) return 'dashboard'
  if (hasModuleAccess(user, 'dashboard')) return 'dashboard'
  return (user.modules ?? [])[0] ?? 'hr'
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
export const isDirector         = (role?: string | null) => normalizeClientRole(role) === 'director'
export const isAdminOfficer     = (role?: string | null) => normalizeClientRole(role) === 'admin_officer'
export const isFinanceOfficer   = (role?: string | null) => normalizeClientRole(role) === 'finance_officer'
export const isInventoryOfficer = (role?: string | null) => normalizeClientRole(role) === 'inventory_officer'
export const isKilimallOfficer  = (role?: string | null) => normalizeClientRole(role) === 'kilimall_officer'
export const isTechnicalLead    = (role?: string | null) => normalizeClientRole(role) === 'technical_lead'
export const isTechnician       = (role?: string | null) => normalizeClientRole(role) === 'technician'
export const isSalesRep         = (role?: string | null) => normalizeClientRole(role) === 'sales_rep'

// Keep client-side HR controls aligned with the server permission matrix.
// Leave decisions are intentionally broader than general HR administration:
// finance and technical leads may decide leave through the dedicated API, while
// employee/payroll administration remains limited to director/admin officer.
export const HR_MANAGER_ROLES: readonly UserRole[] = ['director', 'admin_officer']
export const LEAVE_APPROVER_ROLES: readonly UserRole[] = [
  'director',
  'admin_officer',
  'finance_officer',
  'technical_lead',
]

export const canManageHRRole = (role?: string | null) =>
  HR_MANAGER_ROLES.includes(normalizeClientRole(role) as UserRole)

export const canApproveLeaveRole = (role?: string | null) =>
  LEAVE_APPROVER_ROLES.includes(normalizeClientRole(role) as UserRole)

// Backward-compatible helper names retained for existing module code.
export const isAdmin      = isDirector
export const isFinance    = isFinanceOfficer
export const isLeadTech   = isTechnicalLead
export const isRepairTech = isTechnician

// Composite checks.
export const canManageMoney   = (role?: string | null) => ['director', 'finance_officer'].includes(normalizeClientRole(role))
export const canManageProcess = (role?: string | null) => ['director', 'admin_officer', 'finance_officer'].includes(normalizeClientRole(role))
export const canManageTech    = (role?: string | null) => ['director', 'technical_lead'].includes(normalizeClientRole(role))
export const canManageSettings = (role?: string | null) => ['director', 'admin_officer'].includes(normalizeClientRole(role))
export const canViewAuditTrail = (role?: string | null) => normalizeClientRole(role) === 'director'
export const isTechRole       = (role?: string | null) => ['technical_lead', 'technician'].includes(normalizeClientRole(role))
