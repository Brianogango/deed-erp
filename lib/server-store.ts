import 'server-only'
import { sql, withDbTransaction } from './auth/db'
import { isBlobKey, readBlob, writeBlob } from './blob-store'

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

export async function loadAppState(keys?: string[]): Promise<AppStateMap> {
  try {
    await ensureTable()
    const wantedKeys = keys?.filter(Boolean)
    const { rows } = wantedKeys?.length
      ? await sql`SELECT key, value FROM app_state WHERE key = ANY(${wantedKeys})`
      : await sql`SELECT key, value FROM app_state`
    const state = rowsToAppState(rows as { key: string; value: string }[])
    try {
      const { readStoreRecords } = await import('./prisma-store')
      const fromPrisma = await readStoreRecords(wantedKeys)
      Object.assign(state, fromPrisma)
    } catch { /* store_records may not exist yet */ }
    // Binary payloads live on the filesystem; overlay them for explicitly
    // requested keys. Missing files fall back to any legacy app_state row.
    if (wantedKeys?.length) {
      for (const key of wantedKeys.filter(isBlobKey)) {
        const blob = await readBlob(key)
        if (blob !== null) {
          try { state[key] = JSON.parse(blob) } catch { state[key] = blob }
        }
      }
    }
    // Phase 2b: the repairs table is authoritative — serve it whenever the
    // caller asks for (or bulk-loads) the repairs store.
    if (!wantedKeys || wantedKeys.includes('deed_repairs_v2')) {
      const fromPrisma = await import('./repair-mirror')
        .then(m => m.loadRepairsFromPrisma())
        .catch(() => null)
      if (fromPrisma) state['deed_repairs_v2'] = fromPrisma
    }
    return state
  } catch {
    return {}
  }
}

/**
 * loadAppState for read-modify-write writers. A swallowed load failure
 * returns {} — a following saveStoreKeys would then overwrite the full ledger
 * with a one-item array. Writers must fail instead of wiping.
 */
export async function loadAppStateForWrite(keys?: string[]): Promise<AppStateMap> {
  await ensureTable()
  const wantedKeys = keys?.filter(Boolean)
  const { rows } = wantedKeys?.length
    ? await sql`SELECT key, value FROM app_state WHERE key = ANY(${wantedKeys})`
    : await sql`SELECT key, value FROM app_state`
  const state = rowsToAppState(rows as { key: string; value: string }[])
  try {
    const { readStoreRecords } = await import('./prisma-store')
    Object.assign(state, await readStoreRecords(wantedKeys))
  } catch { /* store_records may not exist yet */ }
  if (wantedKeys?.length) {
    for (const key of wantedKeys.filter(isBlobKey)) {
      const blob = await readBlob(key)
      if (blob !== null) {
        try { state[key] = JSON.parse(blob) } catch { state[key] = blob }
      }
    }
  }
  // Phase 2c: the repairs table is the write target too — read-modify-write
  // cycles must start from the authoritative copy, not the frozen blob backup.
  if (!wantedKeys || wantedKeys.includes('deed_repairs_v2')) {
    const fromPrisma = await import('./repair-mirror')
      .then(m => m.loadRepairsFromPrisma())
      .catch(() => null)
    if (fromPrisma) state['deed_repairs_v2'] = fromPrisma
  }
  return state
}

export async function loadInitialAppState(): Promise<AppStateMap> {
  try {
    await ensureTable()
    // Binary payloads (receipt scans, repair photos, payment screenshots) are
    // stored under their own keys and served by dedicated routes — keep them
    // out of the initial hydration payload shipped inside the page HTML.
    const excludedKeyPatterns = ['expense_receipt_%', 'repair_photos_%', 'repair_payment_proof_%', 'product_photos_%']
    const { rows } = await sql`
      SELECT key, value
      FROM app_state
      WHERE key NOT LIKE ${excludedKeyPatterns[0]}
        AND key NOT LIKE ${excludedKeyPatterns[1]}
        AND key NOT LIKE ${excludedKeyPatterns[2]}
        AND key NOT LIKE ${excludedKeyPatterns[3]}
    `
    const state = rowsToAppState(rows as { key: string; value: string }[])
    try {
      const { readStoreRecords } = await import('./prisma-store')
      Object.assign(state, await readStoreRecords())
      for (const key of Object.keys(state)) {
        if (isBlobKey(key)) delete state[key]
      }
    } catch { /* store_records may not exist yet */ }
    const fromPrisma = await import('./repair-mirror')
      .then(m => m.loadRepairsFromPrisma())
      .catch(() => null)
    if (fromPrisma) state['deed_repairs_v2'] = fromPrisma
    return state
  } catch {
    return {}
  }
}

/**
 * Cheap change-detection fingerprint for a set of keys (max updated_at + row
 * count). Lets GET /api/store answer If-None-Match with a 304 without loading
 * or serializing megabytes of values.
 */
export async function getAppStateVersion(keys: string[]): Promise<string> {
  try {
    await ensureTable()
    const { rows } = await sql`
      SELECT COALESCE(MAX(updated_at), '') AS latest, COUNT(*) AS n
      FROM app_state
      WHERE key = ANY(${keys})
    `
    const row = rows?.[0] as { latest?: string; n?: string | number } | undefined
    let latest = String(row?.latest ?? '')
    let sqlN = Number(row?.n ?? 0)
    try {
      const { storeRecordVersion } = await import('./prisma-store')
      const prismaVer = await storeRecordVersion(keys)
      if (prismaVer.latest > latest) latest = prismaVer.latest
      sqlN += prismaVer.n
    } catch { /* store_records may not exist yet */ }
    return `${latest}:${sqlN}`
  } catch {
    return ''
  }
}

export async function getLatestAppStateUpdatedAt(): Promise<string> {
  try {
    await ensureTable()
    const { rows } = await sql`
      SELECT COALESCE(MAX(updated_at), '') AS updated_at
      FROM app_state
    `
    let latest = String((rows?.[0] as { updated_at?: string } | undefined)?.updated_at ?? '')
    try {
      const { latestStoreRecordUpdatedAt } = await import('./prisma-store')
      const prismaLatest = await latestStoreRecordUpdatedAt()
      if (prismaLatest > latest) latest = prismaLatest
    } catch { /* store_records may not exist yet */ }
    return latest
  } catch {
    return ''
  }
}

export async function loadAppStateChangesSince(sinceUpdatedAt: string): Promise<{
  changes: AppStateMap
  latestUpdatedAt: string
}> {
  try {
    await ensureTable()
    const { rows } = await sql`
      SELECT key, value, updated_at
      FROM app_state
      WHERE updated_at > ${sinceUpdatedAt}
      ORDER BY updated_at ASC
    `
    const typed = rows as { key: string; value: string; updated_at: string }[]
    const changes = rowsToAppState(typed.map(row => ({ key: row.key, value: row.value })))
    const latestUpdatedAt = typed.length > 0 ? typed[typed.length - 1].updated_at : sinceUpdatedAt
    try {
      const { loadStoreRecordChangesSince } = await import('./prisma-store')
      const fromPrisma = await loadStoreRecordChangesSince(sinceUpdatedAt)
      Object.assign(changes, fromPrisma.changes)
      if (fromPrisma.latestUpdatedAt > latestUpdatedAt) {
        return { changes, latestUpdatedAt: fromPrisma.latestUpdatedAt }
      }
    } catch { /* store_records may not exist yet */ }
    return { changes, latestUpdatedAt }
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
    await ensureTable()
    const now = new Date().toISOString()
    // Binary payloads go to the filesystem, never into app_state — a 3 MB
    // base64 receipt in the table bloats every sync, poll, and backup.
    const blobWrites = Object.entries(entries).filter(([key]) => isBlobKey(key))
    if (blobWrites.length > 0) {
      await Promise.all(blobWrites.map(([key, value]) => writeBlob(key, value)))
    }
    const pairs = Object.entries(entries).filter(([key]) => !isBlobKey(key))
    if (pairs.length === 0) return

    let backend: 'prisma' | 'dual' | 'app_state' = 'prisma'
    try {
      const prismaStore = await import('./prisma-store')
      backend = prismaStore.storeBackend()
      if (backend !== 'app_state') {
        await prismaStore.writeStoreRecords(Object.fromEntries(pairs))
      }
    } catch (err) {
      console.error('[server-store] prisma store_records write failed:', err)
      if (backend === 'prisma') backend = 'dual'
    }

    // app_state remains a backup until STORE_BACKEND=prisma after transfer.
    if (backend !== 'prisma') {
      const keys = pairs.map(([key]) => key)
      const values = pairs.map(([, value]) => value)
      await sql`
        INSERT INTO app_state (key, value, updated_at)
        SELECT k, v, ${now} FROM unnest(${keys}::text[], ${values}::text[]) AS t(k, v)
        ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `
    }

    // Repairs migration phase 2c: the repairs table is authoritative — upsert
    // synchronously (fingerprinted — only changed rows) so a following read
    // never sees a pre-write state.
    if (entries['deed_repairs_v2'] && process.env.NODE_ENV !== 'test') {
      await import('./repair-mirror')
        .then(m => m.mirrorRepairsToPrisma(entries['deed_repairs_v2']))
        .catch(err => console.error('[repair-mirror] sync write failed:', err))
    }
    // Accounting / inventory dual-write mirrors.
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
      if (entries['deed_deliveries']) {
        void import('./delivery-mirror')
          .then(async m => {
            const parsed = JSON.parse(entries['deed_deliveries'] || '[]')
            if (!Array.isArray(parsed)) return
            for (const delivery of parsed) await m.mirrorDeliveryToPrisma(delivery)
          })
          .catch(() => {})
      }
      const extraMirrors = ['deed_purchaseOrders', 'deed_serials', 'deed_stockMoves', 'deed_receipts'] as const
      if (extraMirrors.some(key => entries[key])) {
        void import('./blob-transfer')
          .then(async m => {
            for (const key of extraMirrors) {
              if (entries[key]) await m.mirrorKnownDomain(key, entries[key], null)
            }
          })
          .catch(() => {})
      }
    }
  } catch (err) {
    console.error('[server-store] saveStoreKeys error:', err)
  }
}
