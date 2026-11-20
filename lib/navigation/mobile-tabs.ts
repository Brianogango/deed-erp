import type { ModuleId } from '@/lib/store'
import { hasModuleAccess } from '@/lib/auth/access'
import { canonicalRole } from '@/lib/auth/roles'

/**
 * The phone tab bar: Home, two working modules, My work, Menu.
 *
 * Which two modules is the only judgement here. A person who pinned modules
 * in the side menu has said what they use, so their first two pins win. Others
 * get their role's usual pair; anything their access does not allow is
 * skipped, and the gap is filled from the modules they do have, in menu order.
 */

/** Routes and short labels for the modules a tab can hold. */
export const MOBILE_TAB_MODULES: Partial<Record<ModuleId, { href: string; label: string }>> = {
  sales: { href: '/sales', label: 'Sales' },
  crm: { href: '/crm', label: 'CRM' },
  pos: { href: '/pos', label: 'POS' },
  ecommerce: { href: '/ecommerce', label: 'Shop' },
  kilimall: { href: '/kilimall', label: 'Kilimall' },
  contacts: { href: '/contacts', label: 'Contacts' },
  inventory: { href: '/inventory', label: 'Stock' },
  purchase: { href: '/purchases', label: 'Purchases' },
  delivery: { href: '/delivery', label: 'Delivery' },
  repair: { href: '/repairs', label: 'Repairs' },
  refurbishment: { href: '/refurbishment', label: 'Refurb' },
  reconfiguration: { href: '/reconfiguration', label: 'Reconfig' },
  outsource: { href: '/outsource', label: 'Outsource' },
  after_sales: { href: '/aftersales', label: 'After-sales' },
  holdovers: { href: '/holdovers', label: 'Holdovers' },
  company_property: { href: '/property', label: 'Assets' },
  accounting: { href: '/finance', label: 'Finance' },
  deposits: { href: '/deposits', label: 'Deposits' },
  expenses: { href: '/expenses', label: 'Expenses' },
  hr: { href: '/hr', label: 'HR' },
}

/** Menu order, for filling a gap when a role's usual module is not allowed. */
const MENU_ORDER: ModuleId[] = [
  'sales', 'crm', 'pos', 'ecommerce', 'kilimall', 'contacts', 'inventory', 'purchase', 'delivery',
  'repair', 'refurbishment', 'reconfiguration', 'outsource', 'after_sales', 'holdovers',
  'company_property', 'accounting', 'deposits', 'expenses', 'hr',
]

const ROLE_TABS: Record<string, ModuleId[]> = {
  director: ['sales', 'accounting'],
  admin_officer: ['sales', 'repair'],
  finance_officer: ['accounting', 'expenses'],
  inventory_officer: ['inventory', 'purchase'],
  kilimall_officer: ['kilimall', 'inventory'],
  sales_rep: ['sales', 'crm'],
  technical_lead: ['repair', 'inventory'],
  technician: ['repair'],
}

type TabUser = { role?: string | null; modules?: ModuleId[] | null } | null | undefined

export function mobileTabModules(user: TabUser, pinned: readonly string[] = [], count = 2): ModuleId[] {
  if (!user) return []
  const allowed = (id: string): id is ModuleId =>
    id in MOBILE_TAB_MODULES && hasModuleAccess(user as never, id as ModuleId)
  const out: ModuleId[] = []
  const take = (ids: readonly string[]) => {
    for (const id of ids) {
      if (out.length >= count) return
      if (allowed(id) && !out.includes(id)) out.push(id)
    }
  }
  take(pinned)
  take(ROLE_TABS[canonicalRole(user.role)] ?? [])
  // Self-service modules (HR, expenses) are open to everyone, so they only
  // fill a gap after the person's operational modules.
  take(MENU_ORDER.filter(id => (user.modules ?? []).includes(id) && id !== 'hr' && id !== 'expenses'))
  // Then self-service: HR (leave, payslips) before Expenses.
  take(['hr', 'expenses'])
  take(MENU_ORDER)
  return out
}

/**
 * The tab bar is on every screen except the POS till, which needs the whole
 * screen. Open records keep it too; their own bottom actions sit above it.
 */
export function mobileTabsHiddenFor(pathname: string, _search?: URLSearchParams | null): boolean {
  return pathname === '/pos' || pathname.startsWith('/pos/')
}
