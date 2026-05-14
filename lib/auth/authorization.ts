import 'server-only'

import type { PublicUser, UserRole } from './types'

export const normalizePermissionRole = (role: string | null | undefined): UserRole | null => {
  if (!role) return null
  const aliases: Record<string, UserRole> = {
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
  return aliases[role] ?? (role as UserRole)
}

export const isSuperAdminRole = (role: string | null | undefined) => normalizePermissionRole(role) === 'director'

const roleMatrix = {
  manageUsers:               ['director'] as UserRole[],
  viewUsers:                 ['director', 'admin_officer'] as UserRole[],
  manageHR:                  ['director', 'admin_officer'] as UserRole[],
  approveLeave:              ['director', 'admin_officer'] as UserRole[],
  approvePayroll:            ['director', 'finance_officer'] as UserRole[],
  manageInventoryApprovals:  ['director', 'inventory_officer', 'technical_lead', 'kilimall_officer'] as UserRole[],
  postFinancial:             ['director', 'finance_officer'] as UserRole[],
  approvePurchaseOrder:      ['director', 'admin_officer', 'finance_officer'] as UserRole[],
  approveDiscount:           ['director', 'admin_officer', 'finance_officer'] as UserRole[],
  manageMasterData:          ['director', 'admin_officer', 'finance_officer'] as UserRole[],
  viewAuditLog:              ['director'] as UserRole[],
} as const

export type PermissionAction = keyof typeof roleMatrix

export const hasPermission = (user: Pick<PublicUser, 'role'> | null | undefined, action: PermissionAction) => {
  if (!user) return false
  const normalizedRole = normalizePermissionRole(user.role)
  return !!normalizedRole && roleMatrix[action].includes(normalizedRole)
}

export const assertPermission = (user: Pick<PublicUser, 'role'> | null | undefined, action: PermissionAction) => {
  if (!hasPermission(user, action)) {
    const error = new Error('Forbidden')
    ;(error as Error & { status?: number }).status = 403
    throw error
  }
}
