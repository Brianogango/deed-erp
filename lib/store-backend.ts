/**
 * Which persistence layer owns the shared ERP store (`/api/store` keys).
 *
 * - `app_state` (default): legacy whole-collection rows in `app_state`.
 *   Reads and writes stay there; Prisma projection tables are not touched.
 * - `dual`: reads stay on `app_state` (still authoritative) while every save is
 *   also written to the Prisma projection, so parity can be checked before a
 *   cutover.
 * - `prisma`: `erp_state_keys` / `erp_state_records` are authoritative;
 *   `app_state` is only a read fallback for keys that were never backfilled.
 *
 * The default is deliberately the legacy layer. Switching to `prisma` is an
 * explicit operator decision taken only after the cutover runbook
 * (docs/PRISMA_STATE_CUTOVER.md) has been followed and parity certified.
 * Deploying new code must never silently move production to an empty store.
 */
export type StoreBackend = 'prisma' | 'dual' | 'app_state'

export function storeBackend(): StoreBackend {
  const raw = String(process.env.STORE_BACKEND || 'app_state').trim().toLowerCase()
  if (raw === 'prisma') return 'prisma'
  if (raw === 'dual') return 'dual'
  // 'app_state', 'blob', unknown or misspelt values all fail safe to legacy.
  return 'app_state'
}

/** True when saves must write the Prisma projection tables. */
export function writesPrismaState(backend: StoreBackend = storeBackend()): boolean {
  return backend === 'prisma' || backend === 'dual'
}

/** True when saves must write the legacy app_state rows. */
export function writesLegacyAppState(backend: StoreBackend = storeBackend()): boolean {
  return backend === 'app_state' || backend === 'dual'
}

/** True when reads are served from the Prisma projection first. */
export function readsPrismaState(backend: StoreBackend = storeBackend()): boolean {
  return backend === 'prisma'
}
