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
  lockedUntil?: string | null
  mustChangePassword?: boolean
}

export interface AuthUserRecord extends PublicUser {
  passwordHash: string
  failedLoginAttempts: number
  lockedUntil: string | null
}

export interface CreateUserInput {
  username: string
  name: string
  role: UserRole
  modules: ModuleId[]
  active: boolean
  password: string
  mustChangePassword?: boolean
}

export interface UpdateUserInput {
  username?: string
  name?: string
  role?: UserRole
  modules?: ModuleId[]
  active?: boolean
  password?: string
  unlock?: boolean
  mustChangePassword?: boolean
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

// Default module access presets per role (used when creating a new user)
export const ROLE_DEFAULT_MODULES: Record<UserRole, ModuleId[]> = {
  admin: [...MODULE_IDS] as ModuleId[],
  finance: [
    'dashboard', 'accounting', 'sales', 'purchase', 'contacts',
    'inventory', 'hr', 'sops', 'expenses', 'leave', 'my_documents',
  ],
  lead_tech: [
    'dashboard', 'repair', 'refurbishment', 'inventory', 'outsource',
    'sops', 'expenses', 'leave', 'my_documents',
  ],
  repair_tech: [
    'dashboard', 'repair',
    'sops', 'expenses', 'leave', 'my_documents',
  ],
  sales_rep: [
    'dashboard', 'crm', 'sales', 'contacts', 'inventory', 'delivery',
    'after_sales', 'sops', 'expenses', 'leave', 'my_documents',
  ],
}
