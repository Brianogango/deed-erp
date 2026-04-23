import type { ModuleId, PublicUser, UserRole } from './types'

export const PUBLIC_USERS: PublicUser[] = [
  {
    id: 'u1',
    username: 'admin',
    name: 'System Administrator',
    role: 'admin',
    modules: ['dashboard', 'sales', 'crm', 'inventory', 'contacts', 'purchase', 'repair', 'accounting', 'hr', 'delivery'],
    active: true,
    createdAt: '2026-04-01',
  },
  {
    id: 'u2',
    username: 'finance1',
    name: 'Faith Achieng',
    role: 'finance',
    modules: ['dashboard', 'accounting', 'hr'],
    active: true,
    createdAt: '2026-04-01',
  },
  {
    id: 'u3',
    username: 'leadtech1',
    name: 'Peter Mwangi',
    role: 'lead_tech',
    modules: ['dashboard', 'repair', 'inventory', 'hr'],
    active: true,
    createdAt: '2026-04-01',
  },
  {
    id: 'u4',
    username: 'tech1',
    name: 'James Otieno',
    role: 'repair_tech',
    modules: ['dashboard', 'repair', 'hr'],
    active: true,
    createdAt: '2026-04-01',
  },
  {
    id: 'u5',
    username: 'tech2',
    name: 'Amina Hassan',
    role: 'repair_tech',
    modules: ['dashboard', 'repair', 'hr'],
    active: true,
    createdAt: '2026-04-01',
  },
  {
    id: 'u6',
    username: 'sales1',
    name: 'Grace Njeri',
    role: 'sales_rep',
    modules: ['dashboard', 'sales', 'crm', 'contacts', 'hr'],
    active: true,
    createdAt: '2026-04-01',
  },
]

export const SAMPLE_CREDENTIALS: Array<{
  username: string
  password: string
  label: string
  role: UserRole
  modules: ModuleId[]
}> = [
  {
    username: 'admin',
    password: 'admin123',
    label: 'Administrator',
    role: 'admin',
    modules: ['dashboard', 'sales', 'crm', 'inventory', 'contacts', 'purchase', 'repair', 'accounting', 'hr', 'delivery'],
  },
  {
    username: 'finance1',
    password: 'finance123',
    label: 'Finance / Accounts',
    role: 'finance',
    modules: ['dashboard', 'accounting', 'hr'],
  },
  {
    username: 'leadtech1',
    password: 'leadtech123',
    label: 'Lead Technician',
    role: 'lead_tech',
    modules: ['dashboard', 'repair', 'inventory', 'hr'],
  },
  {
    username: 'tech1',
    password: 'tech123',
    label: 'Technician',
    role: 'repair_tech',
    modules: ['dashboard', 'repair', 'hr'],
  },
  {
    username: 'tech2',
    password: 'tech123',
    label: 'Technician',
    role: 'repair_tech',
    modules: ['dashboard', 'repair', 'hr'],
  },
  {
    username: 'sales1',
    password: 'sales123',
    label: 'Sales Representative',
    role: 'sales_rep',
    modules: ['dashboard', 'sales', 'crm', 'contacts', 'hr'],
  },
]
