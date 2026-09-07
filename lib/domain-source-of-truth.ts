/**
 * One source of truth per ERP domain.
 *
 * Prisma REST is the write path for catalogs, CRM, HR, and payroll. The
 * `deed_*` KV blob is a read cache / SSE fan-out for those keys — clients must
 * not POST a different shape back through /api/store.
 *
 * Blob (KV) remains operational SoT for POs, serials, stock moves, deliveries,
 * and receipts until their dedicated cutover (see lib/blob-cutover.ts).
 *
 * Dual-write domains (invoices, sale orders, journals, repairs) still converge
 * both sides; repairs reads Prisma first on the server.
 */

export type DomainTruth = 'prisma' | 'kv' | 'dual_write'

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
  sale_orders: 'dual_write',
  invoices: 'dual_write',
  journals: 'dual_write',
  payments: 'dual_write',
  accounts: 'dual_write',
  deposits: 'dual_write',
  holdovers: 'dual_write',
  stock_reservations: 'dual_write',
  purchase_orders: 'kv',
  serials: 'kv',
  stock_moves: 'kv',
  deliveries: 'kv',
  receipts: 'kv',
} as const satisfies Record<string, DomainTruth>

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

export const VISIBLE_POLL_INTERVAL_MS = 60_000
