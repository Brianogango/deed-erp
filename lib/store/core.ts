import type { ModuleId as AuthModuleId, UserRole as AuthUserRole, PublicUser } from '@/lib/auth/types'

export type ModuleId = AuthModuleId

export type UserRole = AuthUserRole

export type User = PublicUser

// ─── Stock Locations ──────────────────────────────────────────────────────────
export type LocationId = 'warehouse' | 'shop' | 'repair_unit' | 'computer_aid' | 'computer_aid_collected' | 'computer_aid_issues' | 'vendor' | 'customer' | 'employee' | 'pending_testing' | 'quarantine'

export interface AuditLog {
  id: string; date: string; user: string; action: string; documentRef: string; details: string
}

export interface WorkflowApproval {
  id: string
  process: 'leave' | 'expense' | 'salary_change' | 'salary_advance' | 'hiring' | 'payroll'
  ref: string
  targetId: string
  targetName: string
  stepName: string
  approverRole: UserRole
  approverUserId?: string
  status: 'pending' | 'approved' | 'rejected'
  requestedBy: string
  requestedDate: string
  decisionDate?: string
}
