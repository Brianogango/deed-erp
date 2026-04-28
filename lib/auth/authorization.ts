import 'server-only'

import type { PublicUser, UserRole } from './types'

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
  return roleMatrix[action].includes(user.role)
}

export const assertPermission = (user: Pick<PublicUser, 'role'> | null | undefined, action: PermissionAction) => {
  if (!hasPermission(user, action)) {
    const error = new Error('Forbidden')
    ;(error as Error & { status?: number }).status = 403
    throw error
  }
}
