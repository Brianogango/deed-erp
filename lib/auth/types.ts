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
  'sop_documents',
  'after_sales',
  'deposits',
  'holdovers',
  // Self-service modules — accessible to every logged-in user
  'expenses',
  'leave',
  'my_documents',
  // AI assistant — granted per-user like any other module, starting with director.
  'jarvis',
] as const

export type ModuleId = (typeof MODULE_IDS)[number]

export const USER_ROLES = [
  'director',
  'admin_officer',
  'finance_officer',
  'inventory_officer',
  'kilimall_officer',
  'sales_rep',
  'technical_lead',
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
  mustChangePassword?: boolean
  employeeId?: string | null
  email?: string | null
}

export interface AuthUserRecord extends PublicUser {
  passwordHash: string
  failedLoginAttempts: number
  lockedUntil: string | null
}

export interface CreateUserInput {
  employeeId?: string
  username?: string
  name?: string
  role: UserRole
  modules: ModuleId[]
  active?: boolean
  password?: string
  mustChangePassword?: boolean
  email?: string | null
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
  employeeId?: string | null
  email?: string | null
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

const SELF_SERVICE_MODULES: ModuleId[] = ['hr', 'sops', 'expenses', 'leave', 'my_documents']
const allModules = [...MODULE_IDS] as ModuleId[]
const withSelfService = (modules: ModuleId[]): ModuleId[] => Array.from(new Set([...modules, ...SELF_SERVICE_MODULES])) as ModuleId[]

// Default module access presets per role (used when creating a new user)
// jarvis starts opted-in for director only — other roles get it via the
// same per-user module grant UI used for every other module (Settings/HR).
export const ROLE_DEFAULT_MODULES: Record<UserRole, ModuleId[]> = {
  director: allModules,
  admin_officer: withSelfService([
    'dashboard', 'sales', 'crm', 'contacts', 'purchase', 'inventory', 'delivery', 'after_sales', 'deposits', 'holdovers',
  ]),
  finance_officer: withSelfService([
    'dashboard', 'accounting', 'sales', 'crm', 'contacts', 'purchase', 'inventory', 'kilimall', 'ecommerce', 'deposits',
  ]),
  inventory_officer: withSelfService([
    'dashboard', 'inventory', 'delivery', 'purchase', 'holdovers',
  ]),
  kilimall_officer: withSelfService([
    'dashboard', 'kilimall', 'inventory', 'delivery', 'ecommerce', 'after_sales',
  ]),
  sales_rep: withSelfService([
    'dashboard', 'sales', 'crm', 'contacts', 'delivery', 'after_sales', 'holdovers',
  ]),
  technical_lead: withSelfService([
    'dashboard', 'repair', 'refurbishment', 'inventory', 'outsource', 'after_sales', 'holdovers',
  ]),
  technician: withSelfService([
    'dashboard', 'repair',
  ]),
}
