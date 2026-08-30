import type { NextRequest } from 'next/server'

import { isKnownClientAppStateKey } from '@/lib/app-state-hydration'

type StoreUser = {
  role?: unknown
  modules?: unknown
}

type StoreWritePolicy = {
  roles: readonly string[]
  modules?: readonly string[]
}

const DIRECTOR = ['director', 'admin', 'super_admin'] as const
const ADMIN = [...DIRECTOR, 'admin_officer'] as const
const FINANCE = [...ADMIN, 'finance', 'finance_officer'] as const
const SALES = [...FINANCE, 'sales', 'sales_rep', 'kilimall', 'kilimall_officer', 'technical_lead', 'lead_tech'] as const
const INVENTORY = [...ADMIN, 'inventory', 'inventory_officer', 'technical_lead', 'lead_tech'] as const
const REPAIR = [...FINANCE, 'technical_lead', 'lead_tech', 'technician', 'repair_tech'] as const
const OPERATIONS = [...ADMIN, 'finance_officer', 'inventory', 'inventory_officer', 'technical_lead', 'lead_tech'] as const
const ALL_OPERATIONAL = [
  ...FINANCE,
  'inventory', 'inventory_officer',
  'kilimall', 'kilimall_officer',
  'sales', 'sales_rep',
  'technical_lead', 'lead_tech',
  'technician', 'repair_tech',
] as const

const policy = (roles: readonly string[], modules?: readonly string[]): StoreWritePolicy => ({ roles, modules })

/**
 * Explicit legacy app-state write ACL.
 *
 * This list is intentionally exhaustive for every client-writable key registered
 * in app-state-hydration.ts. A new key is DENIED until it is deliberately added
 * here. Dedicated APIs remain responsible for finer row/field/state-transition
 * authorization; this is the outer wholesale-store guard.
 */
export const STORE_WRITE_POLICIES: Readonly<Record<string, StoreWritePolicy>> = Object.freeze({
  deed_companySettings: policy(ADMIN, ['settings']),
  deed_systemSettings: policy(DIRECTOR, ['settings']),
  deed_profileImages: policy(ALL_OPERATIONAL),

  deed_departments: policy(ADMIN, ['hr', 'settings']),
  deed_contracts: policy(ADMIN, ['hr']),
  deed_customerContracts: policy([...ADMIN, 'sales_rep'], ['crm', 'sales']),
  deed_hrDocuments: policy(ADMIN, ['hr', 'my_documents']),
  deed_workflowApprovals: policy(FINANCE, ['sales', 'accounting']),
  deed_employeeAssets: policy(ADMIN, ['hr']),
  deed_leaveBalances: policy(ADMIN, ['hr']),
  deed_leaveRequests: policy([...ADMIN, 'technical_lead'], ['hr', 'leave']),
  deed_salaryAdvances: policy(ADMIN, ['hr']),
  deed_jobPostings: policy(ADMIN, ['hr']),
  deed_candidates: policy(ADMIN, ['hr']),
  deed_trainingPrograms: policy(ADMIN, ['hr']),
  deed_employeeTrainings: policy(ADMIN, ['hr']),
  deed_hr_sops: policy(ADMIN, ['hr', 'sops']),
  deed_hr_perf_targets: policy(ADMIN, ['hr']),

  deed_products: policy(INVENTORY, ['inventory']),
  deed_productPriceHistory: policy(INVENTORY, ['inventory']),
  deed_serials: policy(INVENTORY, ['inventory']),
  deed_bulkStock: policy(INVENTORY, ['inventory']),
  deed_stockTransfers: policy(OPERATIONS, ['inventory']),
  deed_stockAdjustments: policy(OPERATIONS, ['inventory']),
  deed_stockReservations: policy([...INVENTORY, 'sales_rep'], ['inventory', 'sales', 'pos']),
  deed_openingStockPosted: policy(INVENTORY, ['inventory']),
  deed_stockMoves: policy(OPERATIONS, ['inventory', 'pos']),
  deed_refurbishmentJobs: policy(REPAIR, ['refurbishment', 'repair']),
  deed_receipts: policy(INVENTORY, ['purchase', 'inventory']),

  deed_saleOrders: policy(SALES, ['sales']),
  deed_quotes: policy(SALES, ['sales', 'crm']),
  deed_invoices: policy(FINANCE, ['sales', 'accounting', 'repair']),
  deed_payments: policy(FINANCE, ['accounting', 'sales']),
  deed_deliveries: policy([...INVENTORY, 'sales_rep'], ['delivery', 'sales']),
  deed_warranties: policy([...SALES, 'technician'], ['sales', 'repair', 'after_sales']),
  deed_approvalRequests: policy(SALES, ['sales']),
  deed_documentPaymentDetails: policy(FINANCE, ['accounting', 'sales']),
  deed_customerCredits: policy(FINANCE, ['accounting', 'sales']),

  deed_contacts: policy([...SALES, 'inventory_officer'], ['contacts', 'crm', 'sales', 'purchase', 'pos', 'repair', 'delivery', 'after_sales', 'outsource', 'accounting']),
  deed_companies: policy(SALES, ['crm']),
  deed_contactPersons: policy(SALES, ['crm']),
  deed_opportunities: policy(SALES, ['crm']),

  deed_purchaseOrders: policy([...INVENTORY, 'finance_officer'], ['purchase']),
  deed_purchaseReturns: policy(INVENTORY, ['purchase']),

  deed_repairs_v2: policy(REPAIR, ['repair']),
  deed_outboundReleases: policy(REPAIR, ['repair', 'after_sales']),
  deed_outsourceJobs: policy(REPAIR, ['repair', 'outsource']),
  deed_outsourceVendors: policy([...ADMIN, 'technical_lead'], ['outsource', 'repair']),
  deed_outsourcePayments: policy(FINANCE, ['outsource', 'accounting']),

  deed_accounts: policy(FINANCE, ['accounting']),
  deed_bankAccounts: policy(FINANCE, ['accounting']),
  deed_bankRecons: policy(['director', 'finance_officer'], ['accounting']),
  deed_bankStatementLines: policy(['director', 'finance_officer'], ['accounting']),
  deed_journalEntries: policy(FINANCE, ['accounting']),
  deed_expenses: policy(ALL_OPERATIONAL, ['expenses', 'accounting']),
  deed_deposits: policy(FINANCE, ['deposits', 'accounting']),
  deed_refundPayments: policy(FINANCE, ['after_sales', 'accounting']),
  deed_payrollRuns: policy(FINANCE, ['hr', 'accounting']),

  deed_posOrders: policy([...FINANCE, 'sales_rep', 'kilimall_officer'], ['pos']),
  deed_posSessionOpen: policy([...FINANCE, 'sales_rep', 'kilimall_officer'], ['pos']),
  deed_posSessionOpeningCash: policy([...FINANCE, 'sales_rep', 'kilimall_officer'], ['pos']),
  deed_posSessionId: policy([...FINANCE, 'sales_rep', 'kilimall_officer'], ['pos']),
  deed_posSessions: policy([...FINANCE, 'sales_rep', 'kilimall_officer'], ['pos']),

  deed_riders: policy(ADMIN, ['delivery']),
  deed_deliveryJobs: policy([...ADMIN, 'sales_rep', 'inventory_officer', 'technical_lead'], ['delivery']),
  deed_riderWeeklyPays: policy(FINANCE, ['delivery', 'hr']),

  deed_returnOrders: policy([...FINANCE, 'sales_rep', 'technical_lead'], ['after_sales']),
  deed_buyBacks: policy([...FINANCE, 'sales_rep'], ['after_sales']),
  deed_donations: policy(ADMIN, ['after_sales']),
  deed_clientExchanges: policy([...FINANCE, 'sales_rep', 'technical_lead'], ['after_sales']),

  deed_kilimallOrders: policy([...ADMIN, 'kilimall', 'kilimall_officer'], ['kilimall']),
  deed_kilimallDispatches: policy([...ADMIN, 'kilimall', 'kilimall_officer', 'inventory_officer'], ['kilimall']),
  deed_kilimallSettlements: policy([...FINANCE, 'kilimall', 'kilimall_officer'], ['kilimall']),

  deed_sops: policy(ADMIN, ['sops']),
  deed_sopActuals: policy(ALL_OPERATIONAL, ['sops']),
  deed_ref_sops: policy(REPAIR, ['sops', 'refurbishment']),

  deed_holdovers: policy([...SALES, 'inventory_officer'], ['holdovers']),
  deed_companyAssets: policy(ADMIN, ['property']),
})

function normalizedRole(role: unknown): string {
  if (typeof role !== 'string') return ''
  const aliases: Record<string, string> = {
    super_admin: 'director',
    admin: 'director',
    finance: 'finance_officer',
    inventory: 'inventory_officer',
    kilimall: 'kilimall_officer',
    sales: 'sales_rep',
    lead_tech: 'technical_lead',
    repair_tech: 'technician',
  }
  return aliases[role] ?? role
}

function normalizeRoles(roles: readonly string[]): Set<string> {
  return new Set(roles.map(normalizedRole))
}

export function canWriteStoreKey(user: StoreUser, key: string): boolean {
  if (!isKnownClientAppStateKey(key)) return false
  const entry = STORE_WRITE_POLICIES[key]
  if (!entry) return false

  const role = normalizedRole(user.role)
  if (!role || !normalizeRoles(entry.roles).has(role)) return false
  if (!entry.modules?.length) return true
  if (role === 'director') return true

  const modules = new Set(Array.isArray(user.modules) ? user.modules.filter((m): m is string => typeof m === 'string') : [])
  return entry.modules.some(module => modules.has(module))
}

export class StoreWriteAuthorizationError extends Error {
  readonly status = 403
  readonly deniedKeys: string[]

  constructor(keys: string[]) {
    super('Forbidden — app-state write is not permitted for this role/module')
    this.name = 'StoreWriteAuthorizationError'
    this.deniedKeys = keys
  }
}

function keyFromStorePath(pathname: string): string | null {
  if (!pathname.startsWith('/api/store/')) return null
  const raw = pathname.slice('/api/store/'.length).split('/')[0]
  if (!raw) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

export async function assertStoreWriteAuthorized(request: NextRequest, user: StoreUser): Promise<void> {
  const method = request.method.toUpperCase()
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return

  const pathname = request.nextUrl.pathname
  if (pathname !== '/api/store' && !pathname.startsWith('/api/store/')) return

  let keys: string[] = []
  if (pathname === '/api/store') {
    const contentType = request.headers.get('content-type') || ''
    if (!contentType.toLowerCase().includes('application/json')) {
      throw new StoreWriteAuthorizationError(['<invalid-content-type>'])
    }
    const body = await request.clone().json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new StoreWriteAuthorizationError(['<invalid-payload>'])
    }
    keys = Object.keys(body as Record<string, unknown>).filter(key => key.startsWith('deed_'))
  } else {
    const key = keyFromStorePath(pathname)
    if (key) keys = [key]
  }

  const denied = keys.filter(key => !canWriteStoreKey(user, key))
  if (denied.length) throw new StoreWriteAuthorizationError(denied)
}
