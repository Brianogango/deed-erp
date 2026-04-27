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
  'director',
  'admin_officer',
  'finance_officer',
  'inventory_officer',
  'kilimall_officer',
  'sales_rep',
  'lead_tech',
  'technician',
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
}

export interface UpdateUserInput {
  username?: string
  name?: string
  role?: UserRole
  modules?: ModuleId[]
  active?: boolean
  password?: string
  unlock?: boolean
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
  director: [...MODULE_IDS] as ModuleId[],
  admin_officer: [
    'dashboard', 'contacts', 'crm', 'sales', 'purchase', 'inventory',
    'repair', 'kilimall', 'delivery', 'after_sales', 'ecommerce', 'pos', 'outsource',
    'hr', 'sops', 'expenses', 'leave', 'my_documents',
  ],
  finance_officer: [
    'dashboard', 'accounting', 'sales', 'purchase', 'contacts', 'kilimall',
    'inventory', 'hr', 'sops', 'expenses', 'leave', 'my_documents',
  ],
  inventory_officer: [
    'dashboard', 'inventory', 'delivery', 'purchase',
    'sops', 'expenses', 'leave', 'my_documents',
  ],
  kilimall_officer: [
    'dashboard', 'kilimall', 'inventory', 'delivery',
    'sops', 'expenses', 'leave', 'my_documents',
  ],
  sales_rep: [
    'dashboard', 'crm', 'sales', 'contacts', 'inventory', 'delivery',
    'after_sales', 'sops', 'expenses', 'leave', 'my_documents',
  ],
  lead_tech: [
    'dashboard', 'repair', 'refurbishment', 'inventory', 'outsource',
    'sops', 'expenses', 'leave', 'my_documents',
  ],
  technician: [
    'dashboard', 'repair',
    'sops', 'expenses', 'leave', 'my_documents',
  ],
}
