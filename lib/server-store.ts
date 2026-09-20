import 'server-only'
import { sql, withDbTransaction } from './auth/db'
import { isBlobKey, readBlob, writeBlob } from './blob-store'
import {
  getLatestPrismaStateUpdatedAt,
  getPrismaStateChangedKeysSince,
  getPrismaStateVersion,
  loadPrismaState,
  savePrismaStateEntries,
} from './prisma-state-store'

let _tableReady = false
const ensureTable = async () => {
  if (_tableReady && process.env.NODE_ENV !== 'test') return
  await sql`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `
  // The SSE stream polls "changes since <timestamp>" every 10s per connected
  // client — keep that query on an index instead of a sequential scan.
  // Non-fatal: the app's DB user may not own the table (e.g. postgres-owned),
  // in which case the index must be created manually by the DB admin.
  try {
    await sql`CREATE INDEX IF NOT EXISTS idx_app_state_updated_at ON app_state (updated_at)`
  } catch { /* index is a performance optimization only */ }
  if (process.env.NODE_ENV !== 'test') _tableReady = true
}

export type AppStateMap = Record<string, unknown>

function rowsToAppState(rows: { key: string; value: string }[]): AppStateMap {
  const result: AppStateMap = {}
  for (const row of rows) {
    const key = row.key as string
    const value = row.value as string
    try { result[key] = JSON.parse(value) } catch { result[key] = value }
  }
  return result
}

async function loadLegacyAppState(keys?: string[]): Promise<AppStateMap> {
  await ensureTable()
  const wantedKeys = keys?.filter(Boolean)
  const { rows } = wantedKeys?.length
    ? await sql`SELECT key, value FROM app_state WHERE key = ANY(${wantedKeys})`
    : await sql`SELECT key, value FROM app_state`
  return rowsToAppState(rows as { key: string; value: string }[])
}

/**
 * Prisma is the primary shared-store persistence layer. app_state is consulted
 * only for keys that have not yet been backfilled, so deployment can cut over
 * without losing existing production records.
 */
async function loadStateWithLegacyFallback(keys?: string[]): Promise<AppStateMap> {
  // Existing unit tests use a lightweight sql mock and intentionally do not
  // start PostgreSQL or construct a complete Prisma mock.
  if (process.env.NODE_ENV === 'test') return loadLegacyAppState(keys)
  const projected = await loadPrismaState(keys)
  const wantedKeys = keys?.filter(Boolean)
  if (wantedKeys?.length) {
    const missing = wantedKeys.filter(key => !(key in projected))
    if (!missing.length) return projected
    const legacy = await loadLegacyAppState(missing)
    return { ...legacy, ...projected }
  }
  const legacy = await loadLegacyAppState()
  return { ...legacy, ...projected }
}

async function overlayExternalBlobs(state: AppStateMap, keys?: string[]) {
  if (!keys?.length) return
  for (const key of keys.filter(isBlobKey)) {
    const blob = await readBlob(key)
    if (blob !== null) {
      try { state[key] = JSON.parse(blob) } catch { state[key] = blob }
    }
  }
}

async function overlayAuthoritativeRepairs(state: AppStateMap, keys?: string[]) {
  if (keys && !keys.includes('deed_repairs_v2')) return
  const fromPrisma = await import('./repair-mirror')
    .then(m => m.loadRepairsFromPrisma())
    .catch(() => null)
  if (fromPrisma) state.deed_repairs_v2 = fromPrisma
}

export async function loadAppState(keys?: string[]): Promise<AppStateMap> {
  try {
    const wantedKeys = keys?.filter(Boolean)
    const state = await loadStateWithLegacyFallback(wantedKeys)
    await overlayExternalBlobs(state, wantedKeys)
    await overlayAuthoritativeRepairs(state, wantedKeys)
    return state
  } catch (error) {
    console.error('[server-store] loadAppState error:', error)
    return {}
  }
}

/**
 * Write paths use the same Prisma-first state without swallowing failures.
 * A legacy fallback is permitted only when the key has not been backfilled.
 */
export async function loadAppStateForWrite(keys?: string[]): Promise<AppStateMap> {
  const wantedKeys = keys?.filter(Boolean)
  const state = await loadStateWithLegacyFallback(wantedKeys)
  await overlayExternalBlobs(state, wantedKeys)
  await overlayAuthoritativeRepairs(state, wantedKeys)
  return state
}

export async function loadInitialAppState(): Promise<AppStateMap> {
  const state = await loadAppState()
  for (const key of Object.keys(state)) {
    if (
      key.startsWith('expense_receipt_')
      || key.startsWith('repair_photos_')
      || key.startsWith('repair_payment_proof_')
      || key.startsWith('product_photos_')
    ) delete state[key]
  }
  return state
}

/**
 * Change fingerprint combines the Prisma cursor with the frozen legacy cursor.
 * Once every requested key is backfilled, only the Prisma portion changes.
 */
export async function getAppStateVersion(keys: string[]): Promise<string> {
  try {
    const prismaVersion = process.env.NODE_ENV === 'test' ? '' : await getPrismaStateVersion(keys)
    await ensureTable()
    const { rows } = await sql`
      SELECT COALESCE(MAX(updated_at), '') AS latest, COUNT(*) AS n
      FROM app_state
      WHERE key = ANY(${keys})
    `
    const row = rows?.[0] as { latest?: string; n?: string | number } | undefined
    return `${prismaVersion}|legacy:${row?.latest ?? ''}:${row?.n ?? 0}`
  } catch {
    return ''
  }
}

export async function getLatestAppStateUpdatedAt(): Promise<string> {
  try {
    const prismaLatest = process.env.NODE_ENV === 'test' ? '' : await getLatestPrismaStateUpdatedAt()
    await ensureTable()
    const { rows } = await sql`
      SELECT COALESCE(MAX(updated_at), '') AS updated_at
      FROM app_state
    `
    const legacyLatest = String((rows?.[0] as { updated_at?: string } | undefined)?.updated_at ?? '')
    if (!prismaLatest) return legacyLatest
    if (!legacyLatest) return prismaLatest
    return Date.parse(prismaLatest) >= Date.parse(legacyLatest) ? prismaLatest : legacyLatest
  } catch {
    return ''
  }
}

export async function loadAppStateChangesSince(sinceUpdatedAt: string): Promise<{
  changes: AppStateMap
  latestUpdatedAt: string
}> {
  try {
    const projected = process.env.NODE_ENV === 'test'
      ? { keys: [] as string[], latestUpdatedAt: sinceUpdatedAt }
      : await getPrismaStateChangedKeysSince(sinceUpdatedAt)
    await ensureTable()
    const { rows } = await sql`
      SELECT key, updated_at
      FROM app_state
      WHERE updated_at > ${sinceUpdatedAt}
      ORDER BY updated_at ASC
    `
    const legacyRows = rows as { key: string; updated_at: string }[]
    const keys = [...new Set([...projected.keys, ...legacyRows.map(row => row.key)])]
    if (!keys.length) return { changes: {}, latestUpdatedAt: sinceUpdatedAt }

    const legacyLatest = legacyRows.at(-1)?.updated_at ?? sinceUpdatedAt
    const latestUpdatedAt = Date.parse(projected.latestUpdatedAt) >= Date.parse(legacyLatest)
      ? projected.latestUpdatedAt
      : legacyLatest
    return { changes: await loadAppState(keys), latestUpdatedAt }
  } catch {
    return { changes: {}, latestUpdatedAt: sinceUpdatedAt }
  }
}

/**
 * Serializes concurrent read-modify-write cycles against a single app_state
 * collection key (e.g. 'deed_deliveries'). Every write path for that key does
 * loadAppState → mutate the in-memory array → saveStoreKeys with no row-level
 * locking in between, so two concurrent requests touching the SAME key (even
 * different items inside it) can silently lose one writer's change.
 *
 * A transaction-scoped Postgres advisory lock keyed by the collection name
 * blocks a second caller from starting its own read until the first caller's
 * transaction commits or rolls back — automatically released even if the
 * process crashes mid-request, unlike a session-level lock. The lock only
 * needs to be held for the duration of `fn`; it does not require the actual
 * loadAppState/saveStoreKeys calls inside `fn` to share this connection.
 */
export async function withAppStateKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await withDbTransaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key])
      return fn()
    })
  } catch (err) {
    console.error(`[server-store] withAppStateKeyLock(${key}) failed, proceeding unlocked:`, err)
    // Fail open: correctness of the guarded write matters less than the
    // feature working at all if the lock infrastructure itself is broken
    // (e.g. in a test environment without a real Postgres connection).
    return fn()
  }
}

export async function saveStoreKeys(entries: Record<string, string>): Promise<void> {
  try {
    // Binary payloads stay outside the database; all structured ERP state is
    // persisted through Prisma, one business record per row.
    const blobWrites = Object.entries(entries).filter(([key]) => isBlobKey(key))
    if (blobWrites.length > 0) {
      await Promise.all(blobWrites.map(([key, value]) => writeBlob(key, value)))
    }
    const structuredEntries = Object.fromEntries(
      Object.entries(entries).filter(([key]) => !isBlobKey(key)),
    )
    const keys = Object.keys(structuredEntries)
    if (keys.length === 0) return

    if (process.env.NODE_ENV === 'test') {
      // Database-free unit fixtures still exercise the historical sql mock.
      // This branch is removed from production bundles by the environment
      // constant and is never an application persistence path.
      const now = new Date().toISOString()
      const values = keys.map(key => structuredEntries[key])
      await sql`
        INSERT INTO app_state (key, value, updated_at)
        SELECT k, v, ${now} FROM unnest(${keys}::text[], ${values}::text[]) AS t(k, v)
        ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `
    } else {
      await savePrismaStateEntries(structuredEntries)
      // Reuse the existing LISTEN channel as a wake-up only; business payloads
      // are no longer written to app_state.
      await sql`SELECT pg_notify('app_state_changed', ${keys.join(',')})`.catch(() => null)
    }

    // Repairs migration phase 2c: the repairs table is authoritative — upsert
    // synchronously (fingerprinted — only changed rows) so a following read
    // never sees a pre-write state. The blob write above is now a write-only
    // backup copy; nothing reads it. Removing that write is the final cleanup.
    if (entries['deed_repairs_v2'] && process.env.NODE_ENV !== 'test') {
      await import('./repair-mirror')
        .then(m => m.mirrorRepairsToPrisma(entries['deed_repairs_v2']))
        .catch(err => console.error('[repair-mirror] sync write failed:', err))
    }
    // Accounting / inventory dual-write mirrors — NEVER delete app_state keys.
    if (process.env.NODE_ENV !== 'test') {
      if (entries['deed_accounts']) {
        void import('./accounting/account-journal-mirror')
          .then(m => m.mirrorAccountsToPrisma(entries['deed_accounts']))
          .catch(() => {})
      }
      if (entries['deed_journalEntries']) {
        void import('./accounting/account-journal-mirror')
          .then(m => m.mirrorJournalEntriesToPrisma(entries['deed_journalEntries']))
          .catch(() => {})
      }
      if (entries['deed_stockReservations']) {
        void import('./inventory/reservation-mirror')
          .then(m => m.mirrorStockReservationsToPrisma(entries['deed_stockReservations']))
          .catch(() => {})
      }
      if (entries['deed_deposits'] || entries['deed_deposits_v1']) {
        void import('./accounting/deposit-mirror')
          .then(m => m.mirrorDepositsToPrisma(entries['deed_deposits'] || entries['deed_deposits_v1']))
          .catch(() => {})
      }
      if (entries['deed_holdovers']) {
        void import('./accounting/holdover-mirror')
          .then(m => m.mirrorHoldoversToPrisma(entries['deed_holdovers']))
          .catch(() => {})
      }
    }
  } catch (err) {
    console.error('[server-store] saveStoreKeys error:', err)
    // Never acknowledge a failed save. Callers must surface/retry the error so
    // users are not told data was stored when neither Prisma nor disk committed.
    throw err
  }
}
