/**
 * One persistence source of truth per ERP domain: PostgreSQL through Prisma.
 *
 * Domains with complete normalized models use their dedicated REST services.
 * Remaining legacy screens persist one business record per ErpStateRecord row;
 * they no longer write whole-array app_state blobs. That projection is an
 * explicit bridge while those screens move to dedicated normalized services.
 */

export type DomainTruth = 'prisma'
export type DomainPersistence = 'normalized' | 'row_projection'

export const DOMAIN_SOURCE_OF_TRUTH = {
  products: 'prisma',
  quotes: 'prisma',
  opportunities: 'prisma',
  employees: 'prisma',
  leave: 'prisma',
  payroll: 'prisma',
  notifications: 'prisma',
  contacts: 'prisma',
  repairs: 'prisma',
  sale_orders: 'prisma',
  invoices: 'prisma',
  journals: 'prisma',
  payments: 'prisma',
  accounts: 'prisma',
  deposits: 'prisma',
  holdovers: 'prisma',
  stock_reservations: 'prisma',
  purchase_orders: 'prisma',
  serials: 'prisma',
  stock_moves: 'prisma',
  deliveries: 'prisma',
  receipts: 'prisma',
} as const satisfies Record<string, DomainTruth>

export const DOMAIN_PERSISTENCE = {
  products: 'normalized',
  quotes: 'normalized',
  opportunities: 'normalized',
  employees: 'normalized',
  leave: 'normalized',
  payroll: 'normalized',
  notifications: 'normalized',
  contacts: 'normalized',
  repairs: 'normalized',
  sale_orders: 'normalized',
  invoices: 'normalized',
  journals: 'normalized',
  payments: 'normalized',
  accounts: 'normalized',
  deposits: 'normalized',
  holdovers: 'normalized',
  stock_reservations: 'normalized',
  purchase_orders: 'normalized',
  serials: 'normalized',
  stock_moves: 'normalized',
  deliveries: 'normalized',
  receipts: 'normalized',
} as const satisfies Record<keyof typeof DOMAIN_SOURCE_OF_TRUTH, DomainPersistence>

/**
 * Client must not POST these keys. Dedicated REST routes own the write; a
 * KV round-trip here is how Prisma and blob shapes drifted.
 */
export const PRISMA_REST_SOT_STORE_KEYS = [
  'deed_quotes',
  'deed_opportunities',
  'deed_oppActivities',
  'deed_leaveRequests',
  'deed_leaveBalances',
  'deed_payrollRuns',
  'deed_contacts',
  'deed_companies',
  'deed_contactPersons',
] as const

const PRISMA_REST_SOT_KEY_SET = new Set<string>(PRISMA_REST_SOT_STORE_KEYS)

export function isPrismaRestSotStoreKey(key: string): boolean {
  return PRISMA_REST_SOT_KEY_SET.has(key)
}

export const VISIBLE_POLL_INTERVAL_MS = 10_000
