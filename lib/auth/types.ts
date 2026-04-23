export const MODULE_IDS = [
  'dashboard',
  'sales',
  'crm',
  'inventory',
  'contacts',
  'purchase',
  'pos',
  'repair',
  'refurbishment',
  'delivery',
  'ecommerce',
  'kilimall',
  'accounting',
  'hr',
  'outsource',
  'sops',
  'after_sales',
  // Self-service modules — accessible to every logged-in user
  'expenses',
  'leave',
  'my_documents',
] as const

export type ModuleId = (typeof MODULE_IDS)[number]

export const USER_ROLES = [
  'admin',
  'finance',
  'lead_tech',
  'repair_tech',
  'sales_rep',
] as const

export type UserRole = (typeof USER_ROLES)[number]

export interface PublicUser {
  id: string
  username: string
  name: string
  role: UserRole
  modules: ModuleId[]
  active: boolean
  createdAt: string
}

export interface AuthUserRecord extends PublicUser {
  passwordHash: string
}

export interface CreateUserInput {
  username: string
  name: string
  role: UserRole
  modules: ModuleId[]
  active: boolean
  password: string
}

export interface UpdateUserInput {
  username?: string
  name?: string
  role?: UserRole
  modules?: ModuleId[]
  active?: boolean
  password?: string
}

export interface SessionPayload {
  userId: string
  issuedAt: string
  expiresAt: string
}

export interface ServerSession {
  user: PublicUser
  issuedAt: string
  expiresAt: string
}
