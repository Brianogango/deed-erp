import 'server-only'

import type { PublicUser, UserRole } from './types'

export const normalizePermissionRole = (role: string | null | undefined): UserRole | null => {
  if (!role) return null
  if (role === 'super_admin' || role === 'director') return 'admin'
  return role as UserRole
}

export const isSuperAdminRole = (role: string | null | undefined) => normalizePermissionRole(role) === 'admin'

const roleMatrix = {
  manageUsers:               ['admin'] as UserRole[],
  viewUsers:                 ['admin', 'finance'] as UserRole[],
  manageHR:                  ['admin'] as UserRole[],
  approveLeave:              ['admin'] as UserRole[],
  approvePayroll:            ['admin', 'finance'] as UserRole[],
  manageInventoryApprovals:  ['admin', 'lead_tech'] as UserRole[],
  postFinancial:             ['admin', 'finance'] as UserRole[],
  approvePurchaseOrder:      ['admin', 'finance'] as UserRole[],
  approveDiscount:           ['admin', 'finance'] as UserRole[],
  manageMasterData:          ['admin'] as UserRole[],
  viewAuditLog:              ['admin', 'finance', 'lead_tech'] as UserRole[],
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
