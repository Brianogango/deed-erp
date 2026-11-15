/**
 * Route-scoped boot API groups.
 * Avoids fetching every Prisma list endpoint on every login — only what the
 * current screen needs immediately. StoreProvider does not idle-prefetch the rest.
 */

export type BootApiGroup =
  | 'products'
  | 'contacts'
  | 'sales'
  | 'crm'
  | 'repairs'
  | 'purchases'
  | 'employees'
  | 'leave'
  | 'payroll'
  | 'salary_advances'
  | 'approval_rules'
  | 'stock_moves'


/** Shell user comes from the session. Do not boot HR/settings lists on every route. */
const ALWAYS_BOOT: BootApiGroup[] = []

const ROUTE_BOOT_APIS: Record<string, BootApiGroup[]> = {
  // Dashboard KPI data is already supplied by route-scoped store hydration.
  // Booting the same Prisma collections here fetched every page a second time.
  '/': [],
  '/sales': ['products', 'contacts', 'sales', 'crm'],
  '/crm': ['products', 'contacts', 'sales', 'crm'],
  '/purchases': ['products', 'contacts', 'purchases'],
  '/purchase': ['products', 'contacts', 'purchases'],
  '/operations': ['products', 'stock_moves'],
  '/inventory': ['products', 'stock_moves'],
  '/repairs': ['products', 'contacts'],
  '/contacts': ['contacts'],
  '/hr': ['employees', 'leave', 'payroll', 'salary_advances'],
  '/documents': [],
  // Finance first paint is the store GET (invoices/journals/bank). Catalog and
  // CRM lists idle-prefetch so they do not compete with that payload.
  '/finance': ['payroll'],
  '/accounting': ['payroll'],
  // Invoices carry their sale order's number and the job trail is built on
  // the server, so the sale-order list is not booted here.
  '/finance/invoices': ['contacts'],
  '/pos': ['products', 'contacts'],
  '/delivery': ['contacts'],
  '/aftersales': ['products', 'contacts'],
  '/after_sales': ['products', 'contacts'],
  '/refurbishment': ['products'],
  '/kilimall': ['products'],
  '/ecommerce': ['products', 'contacts'],
  '/expenses': ['contacts'],
  '/outsource': ['contacts'],
  '/deposits': ['contacts'],
  '/holdovers': ['products', 'contacts'],
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

/**
 * Boot groups that are nothing but a store-key download. A route's groups go
 * out in one request instead of one per group — three round trips on /sales
 * became one.
 *
 * deed_stockMoves / deed_serials are hydrated this way, as a remote update
 * that neither marks the keys dirty nor syncs them back, because they are
 * saved as WHOLE collections: loading them from a paginated REST page once put
 * a partial list into synced state and truncated the stored collection.
 */
export const STORE_KEY_BOOT_GROUPS: Partial<Record<BootApiGroup, string[]>> = {
  contacts: ['deed_contacts', 'deed_companies', 'deed_contactPersons'],
  sales: ['deed_quotes', 'deed_saleOrders', 'deed_payments', 'deed_deliveries'],
  crm: ['deed_opportunities', 'deed_oppActivities'],
  repairs: ['deed_repairs_v2'],
  purchases: ['deed_purchaseOrders', 'deed_receipts'],
  stock_moves: ['deed_stockMoves', 'deed_serials'],
}

/** Every store key this route boots, in one list. */
export function bootStoreKeysForRoute(pathname: string): string[] {
  return [...new Set(bootApiGroupsForRoute(pathname).flatMap(g => STORE_KEY_BOOT_GROUPS[g] ?? []))]
}
