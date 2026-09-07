/**
 * Route-scoped boot API groups.
 * Avoids fetching every Prisma list endpoint on every login — only what the
 * current screen needs immediately; the rest idle-prefetches.
 */

export type BootApiGroup =
  | 'products'
  | 'contacts'
  | 'sales'
  | 'crm'
  | 'repairs'
  | 'employees'
  | 'leave'
  | 'payroll'
  | 'salary_advances'
  | 'approval_rules'
  | 'stock_moves'

const ALL_BOOT_API_GROUPS: BootApiGroup[] = [
  'products',
  'contacts',
  'sales',
  'crm',
  'repairs',
  'employees',
  'leave',
  'payroll',
  'salary_advances',
  'approval_rules',
  'stock_moves',
]

/** Always warm these so shell / self-service never flash empty. */
const ALWAYS_BOOT: BootApiGroup[] = ['employees', 'leave', 'approval_rules']

const ROUTE_BOOT_APIS: Record<string, BootApiGroup[]> = {
  // Dashboard first paint: products + sales for KPI cards. Contacts/repairs
  // warm on hover or when those modules open (idle prefetch still covers them).
  '/': ['products', 'sales'],
  '/sales': ['products', 'contacts', 'sales', 'crm'],
  '/crm': ['products', 'contacts', 'sales', 'crm'],
  '/purchases': ['products', 'contacts'],
  '/purchase': ['products', 'contacts'],
  '/operations': ['products', 'stock_moves'],
  '/inventory': ['products', 'stock_moves'],
  '/repairs': ['products', 'contacts', 'repairs'],
  '/contacts': ['contacts'],
  '/hr': ['employees', 'leave', 'payroll', 'salary_advances'],
  // Finance first paint is the store GET (invoices/journals/bank). Catalog and
  // CRM lists idle-prefetch so they do not compete with that payload.
  '/finance': ['payroll'],
  '/accounting': ['payroll'],
  '/finance/invoices': ['contacts', 'sales'],
  '/pos': ['products', 'contacts'],
  '/delivery': ['contacts'],
  '/aftersales': ['products', 'contacts'],
  '/after_sales': ['products', 'contacts'],
  '/refurbishment': ['products'],
  '/kilimall': ['products'],
  '/ecommerce': ['products', 'contacts'],
  '/expenses': ['contacts'],
  '/outsource': ['contacts', 'repairs'],
  '/deposits': ['contacts'],
  '/documents': [],
  '/holdovers': ['products', 'contacts', 'repairs'],
  '/property': ['employees'],
  '/settings': ['approval_rules'],
}

function normalizeRoute(pathname: string) {
  const clean = (pathname || '/').split('?')[0].split('#')[0]
  if (clean.length > 1 && clean.endsWith('/')) return clean.slice(0, -1)
  return clean || '/'
}

/** Longest-prefix match so `/finance/invoices/xyz` still maps to finance. */
export function bootApiGroupsForRoute(pathname: string): BootApiGroup[] {
  const route = normalizeRoute(pathname)
  let matched: BootApiGroup[] = []
  let matchedLen = -1
  for (const [key, groups] of Object.entries(ROUTE_BOOT_APIS)) {
    if (route === key || (key !== '/' && route.startsWith(`${key}/`))) {
      if (key.length > matchedLen) {
        matched = groups
        matchedLen = key.length
      }
    }
  }
  if (route === '/') matched = ROUTE_BOOT_APIS['/'] ?? []
  return Array.from(new Set([...ALWAYS_BOOT, ...matched]))
}

export function remainingBootApiGroups(immediate: BootApiGroup[]): BootApiGroup[] {
  const have = new Set(immediate)
  return ALL_BOOT_API_GROUPS.filter(g => !have.has(g))
}

export { ALL_BOOT_API_GROUPS }
