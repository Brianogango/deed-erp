import 'server-only'

import type { PublicUser, UserRole } from './types'

const roleMatrix = {
  manageUsers:               ['director', 'admin_officer'] as UserRole[],
  viewUsers:                 ['director', 'admin_officer', 'finance_officer'] as UserRole[],
  manageHR:                  ['director', 'admin_officer'] as UserRole[],
  approveLeave:              ['director', 'admin_officer'] as UserRole[],
  approvePayroll:            ['director', 'finance_officer'] as UserRole[],
  manageInventoryApprovals:  ['director', 'admin_officer', 'lead_tech'] as UserRole[],
  postFinancial:             ['director', 'finance_officer'] as UserRole[],
  approvePurchaseOrder:      ['director', 'admin_officer', 'finance_officer'] as UserRole[],
  approveDiscount:           ['director', 'admin_officer', 'finance_officer'] as UserRole[],
  manageMasterData:          ['director', 'admin_officer'] as UserRole[],
  viewAuditLog:              ['director', 'admin_officer', 'finance_officer', 'lead_tech'] as UserRole[],
} as const

export type PermissionAction = keyof typeof roleMatrix

export const hasPermission = (user: Pick<PublicUser, 'role'> | null | undefined, action: PermissionAction) => {
  if (!user) return false
  return roleMatrix[action].includes(user.role)
}

export const assertPermission = (user: Pick<PublicUser, 'role'> | null | undefined, action: PermissionAction) => {
  if (!hasPermission(user, action)) {
    const error = new Error('Forbidden')
    ;(error as Error & { status?: number }).status = 403
    throw error
  }
}
