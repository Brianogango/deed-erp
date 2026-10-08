import 'server-only'
import { sql, withDbTransaction } from './auth/db'
import { isBlobKey, readBlob, writeBlob } from './blob-store'
import {
  getLatestPrismaStateUpdatedAt,
  getPrismaStateChangedKeysSince,
  getPrismaStateKeyVersions,
  getPrismaStateVersion,
  loadPrismaState,
  savePrismaStateEntries,
} from './prisma-state-store'
import { readsPrismaState, storeBackend, writesLegacyAppState, writesPrismaState } from './store-backend'
import { BulkDeleteRefusedError, assessCollectionShrink } from './store-bulk-delete-guard'

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

type AppStateMap = Record<string, unknown>

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
  // STORE_BACKEND=app_state|dual: app_state is authoritative for reads.
  if (!readsPrismaState()) return loadLegacyAppState(keys)
  let projected: AppStateMap
  try {
    projected = await loadPrismaState(keys)
  } catch {
    // Safe rollout: reads remain available if code starts before the additive
    // migration. Writes still fail closed until the Prisma tables exist.
    return loadLegacyAppState(keys)
  }
  const wantedKeys = keys?.filter(Boolean)
  if (wantedKeys?.length) {
    const missing = wantedKeys.filter(key => !(key in projected))
    if (!missing.length) return projected
    let fromStoreRecords: AppStateMap = {}
    try {
      const { readStoreRecords } = await import('./prisma-store')
      fromStoreRecords = await readStoreRecords(missing)
    } catch { /* store_records may not exist yet */ }
    const stillMissing = missing.filter(key => !(key in fromStoreRecords))
    const legacy = stillMissing.length ? await loadLegacyAppState(stillMissing) : {}
    return { ...legacy, ...fromStoreRecords, ...projected }
  }
  if (Object.keys(projected).length > 0) return projected
  try {
    const { readStoreRecords } = await import('./prisma-store')
    const fromStoreRecords = await readStoreRecords()
    if (Object.keys(fromStoreRecords).length > 0) return fromStoreRecords
  } catch { /* store_records may not exist yet */ }
  return loadLegacyAppState()
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

/**
 * Store keys whose screen copy is frozen: the Prisma table is the source and
 * the copy is no longer written (lib/invoice-read-model.server.ts). Saves of
 * these keys are dropped — the change has already been saved through the
 * document's own API route — but other tabs are still told to re-read.
 */
export const FROZEN_STORE_KEYS = new Set(['deed_invoices', 'deed_saleOrders', 'deed_quotes', 'deed_journalEntries', 'deed_accounts', 'deed_contacts', 'deed_purchaseOrders', 'deed_deposits', 'deed_deposits_v1', 'deed_holdovers', 'deed_repairs_v2', 'deed_auditLogs', 'deed_oppActivities'])

async function overlayAuthoritativeInvoices(state: AppStateMap, keys?: string[]) {
  if (keys && !keys.includes('deed_invoices')) return
  const fromPrisma = await import('./invoice-read-model.server')
    .then(m => m.loadScreenInvoices(state.deed_invoices))
    .catch(err => { console.error('[server-store] invoices from table failed:', err); return null })
  if (fromPrisma) state.deed_invoices = fromPrisma
}

async function overlayAuthoritativeSales(state: AppStateMap, keys?: string[]) {
  const want = (key: string) => !keys || keys.includes(key)
  if (!want('deed_saleOrders') && !want('deed_quotes')) return
  const m = await import('./sales-read-model.server')
  if (want('deed_saleOrders')) {
    const orders = await m.loadScreenSaleOrders(state.deed_saleOrders)
      .catch(err => { console.error('[server-store] sale orders from table failed:', err); return null })
    if (orders) state.deed_saleOrders = orders
  }
  if (want('deed_quotes')) {
    const quotes = await m.loadScreenQuotes(state.deed_quotes)
      .catch(err => { console.error('[server-store] quotes from table failed:', err); return null })
    if (quotes) state.deed_quotes = quotes
  }
}

async function overlayAuthoritativeJournals(state: AppStateMap, keys?: string[]) {
  if (keys && !keys.includes('deed_journalEntries')) return
  const fromPrisma = await import('./journal-read-model.server')
    .then(m => m.loadScreenJournals())
    .catch(err => { console.error('[server-store] journals from table failed:', err); return null })
  if (fromPrisma) state.deed_journalEntries = fromPrisma
}

async function overlayAuthoritativeAccounts(state: AppStateMap, keys?: string[]) {
  if (keys && !keys.includes('deed_accounts')) return
  const fromPrisma = await import('./account-read-model.server')
    .then(m => m.loadScreenAccounts(state.deed_accounts))
    .catch(err => { console.error('[server-store] accounts from table failed:', err); return null })
  if (fromPrisma) state.deed_accounts = fromPrisma
}

async function overlayAuthoritativeContacts(state: AppStateMap, keys?: string[]) {
  if (keys && !keys.includes('deed_contacts')) return
  const fromPrisma = await Promise.all([import('./contact-prisma'), import('./prisma')])
    .then(([m, p]) => m.loadScreenContacts(p.default as any, state.deed_contacts))
    .catch(err => { console.error('[server-store] contacts from table failed:', err); return null })
  if (fromPrisma) state.deed_contacts = fromPrisma
}

async function overlayAuthoritativePurchaseOrders(state: AppStateMap, keys?: string[]) {
  if (keys && !keys.includes('deed_purchaseOrders')) return
  const receipts = state.deed_receipts !== undefined
    ? state.deed_receipts
    : (await loadStateWithLegacyFallback(['deed_receipts']).catch(() => ({} as AppStateMap))).deed_receipts
  const fromPrisma = await import('./purchase-order-read-model.server')
    .then(m => m.loadScreenPurchaseOrders(state.deed_purchaseOrders, receipts))
    .catch(err => { console.error('[server-store] purchase orders from table failed:', err); return null })
  if (fromPrisma) state.deed_purchaseOrders = fromPrisma
}

/**
 * Tell open tabs a frozen key changed (its table was written).
 *
 * The store's versions, conditional fetches and live change feed all go by
 * when a key's screen copy last changed. A frozen copy never changes, so the
 * notice also moves that key's change stamp forward — otherwise browsers
 * holding the list are told nothing changed and keep showing the old one.
 */
export async function notifyStoreKeysChanged(keys: string[]): Promise<void> {
  if (!keys.length || process.env.NODE_ENV === 'test') return
  await import('./prisma')
    .then(m => m.default.erpStateKey.updateMany({ where: { key: { in: keys } }, data: { version: { increment: 1 } } }))
    .catch(() => null)
  await sql`UPDATE app_state SET updated_at = now() WHERE key = ANY(${keys})`.catch(() => null)
  await sql`SELECT pg_notify('app_state_changed', ${keys.join(',')})`.catch(() => null)
}

/**
 * Fingerprint of the table behind each frozen key (latest change and row
 * count), folded into the key's version. A table write that never sent a
 * notice still changes the version, so a conditional fetch cannot answer
 * "unchanged" with an old list.
 */
const FROZEN_TABLE_FINGERPRINTS: Record<string, string> = {
  deed_invoices: `SELECT max(updated_at)::text || ':' || count(*) FROM invoices`,
  deed_saleOrders: `SELECT max(updated_at)::text || ':' || count(*) FROM sale_orders`,
  deed_quotes: `SELECT max(updated_at)::text || ':' || count(*) FROM quotes`,
  deed_journalEntries: `SELECT max(created_at)::text || ':' || count(*) || ':' || count(*) FILTER (WHERE is_reversed) FROM journal_entries`,
  deed_accounts: `SELECT max(updated_at)::text || ':' || count(*) FROM account_codes`,
  deed_contacts: `SELECT max(updated_at)::text || ':' || count(*) FROM clients`,
  deed_deposits: `SELECT (SELECT max(updated_at)::text || ':' || count(*) FROM deposits) || ':' || (SELECT count(*) || ':' || coalesce(sum(amount), 0) FROM deposit_payments)`,
  deed_repairs_v2: `SELECT max(updated_at)::text || ':' || count(*) FROM repairs`,
  deed_oppActivities: `SELECT max(created_at)::text || ':' || count(*) || ':' || md5(coalesce(string_agg(screen_extras::text, ',' ORDER BY id), '')) FROM opportunity_activities`,
  deed_holdovers: `SELECT max(updated_at)::text || ':' || count(*) FROM holdovers`,
  deed_purchaseOrders: `SELECT (SELECT max(updated_at)::text || ':' || count(*) FROM purchase_orders) || ':' || (SELECT coalesce(sum(qty_received), 0) || '/' || coalesce(sum(qty_billed), 0) FROM purchase_order_items)`,
}

async function frozenTableFingerprints(keys: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const wanted = keys.filter(key => FROZEN_STORE_KEYS.has(key) && FROZEN_TABLE_FINGERPRINTS[key])
  if (!wanted.length || process.env.NODE_ENV === 'test') return out
  const prisma = (await import('./prisma')).default
  await Promise.all(wanted.map(async key => {
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(FROZEN_TABLE_FINGERPRINTS[key]).catch(() => null)
    const value = rows?.[0] ? Object.values(rows[0])[0] : null
    if (value != null) out[key] = String(value)
  }))
  return out
}

async function overlayAuthoritativeDeposits(state: AppStateMap, keys?: string[]) {
  if (keys && !keys.includes('deed_deposits')) return
  const fromPrisma = await import('./deposit-read-model.server')
    .then(m => m.loadScreenDeposits(state.deed_deposits))
    .catch(err => { console.error('[server-store] deposits from table failed:', err); return null })
  if (fromPrisma) state.deed_deposits = fromPrisma
}

async function overlayAuthoritativeHoldovers(state: AppStateMap, keys?: string[]) {
  if (keys && !keys.includes('deed_holdovers')) return
  const fromPrisma = await import('./holdover-read-model.server')
    .then(m => m.loadScreenHoldovers(state.deed_holdovers))
    .catch(err => { console.error('[server-store] holdovers from table failed:', err); return null })
  if (fromPrisma) state.deed_holdovers = fromPrisma
}

async function overlayAuthoritativeActivities(state: AppStateMap, keys?: string[]) {
  if (keys && !keys.includes('deed_oppActivities')) return
  const fromPrisma = await import('./opportunity-activity-read-model.server')
    .then(m => m.loadScreenActivities(state.deed_oppActivities))
    .catch(err => { console.error('[server-store] activities from table failed:', err); return null })
  if (fromPrisma) state.deed_oppActivities = fromPrisma
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
    await overlayAuthoritativeInvoices(state, wantedKeys)
    await overlayAuthoritativeSales(state, wantedKeys)
    await overlayAuthoritativeJournals(state, wantedKeys)
    await overlayAuthoritativeAccounts(state, wantedKeys)
    await overlayAuthoritativeContacts(state, wantedKeys)
    await overlayAuthoritativePurchaseOrders(state, wantedKeys)
    await overlayAuthoritativeDeposits(state, wantedKeys)
    await overlayAuthoritativeHoldovers(state, wantedKeys)
    await overlayAuthoritativeActivities(state, wantedKeys)
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
  await overlayAuthoritativeInvoices(state, wantedKeys)
  await overlayAuthoritativeSales(state, wantedKeys)
  await overlayAuthoritativeJournals(state, wantedKeys)
  await overlayAuthoritativeAccounts(state, wantedKeys)
  await overlayAuthoritativeContacts(state, wantedKeys)
  await overlayAuthoritativePurchaseOrders(state, wantedKeys)
  await overlayAuthoritativeDeposits(state, wantedKeys)
  await overlayAuthoritativeHoldovers(state, wantedKeys)
  await overlayAuthoritativeActivities(state, wantedKeys)
  return state
}

/**
 * Change fingerprint combines the Prisma cursor with the frozen legacy cursor.
 * Once every requested key is backfilled, only the Prisma portion changes.
 */
export async function getAppStateVersion(keys: string[]): Promise<string> {
  try {
    const prismaVersion = process.env.NODE_ENV === 'test' || !readsPrismaState()
      ? ''
      : await getPrismaStateVersion(keys)
    await ensureTable()
    const { rows } = await sql`
      SELECT COALESCE(MAX(updated_at), '') AS latest, COUNT(*) AS n
      FROM app_state
      WHERE key = ANY(${keys})
    `
    const row = rows?.[0] as { latest?: string; n?: string | number } | undefined
    const tables = await frozenTableFingerprints(keys)
    const tableVersion = Object.keys(tables).sort().map(key => `${key}=${tables[key]}`).join(';')
    return `${prismaVersion}|legacy:${row?.latest ?? ''}:${row?.n ?? 0}${tableVersion ? `|tables:${tableVersion}` : ''}`
  } catch {
    return ''
  }
}

/**
 * Version of each key on its own (Prisma counter + legacy timestamp). Empty
 * string when unknown — never treated as unchanged.
 */
export async function getAppStateKeyVersions(keys: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (!keys.length) return out
  try {
    const projected = process.env.NODE_ENV === 'test' || !readsPrismaState()
      ? {} as Record<string, string>
      : await getPrismaStateKeyVersions(keys)
    await ensureTable()
    const { rows } = await sql`SELECT key, updated_at FROM app_state WHERE key = ANY(${keys})`
    const legacy = new Map((rows as { key: string; updated_at: string }[]).map(r => [r.key, r.updated_at]))
    const tables = await frozenTableFingerprints(keys)
    for (const key of keys) {
      const p = projected[key] ?? ''
      const l = legacy.get(key) ?? ''
      const t = tables[key] ? `|${tables[key]}` : ''
      out[key] = p || l ? `${p}|${l}${t}` : ''
    }
  } catch {
    for (const key of keys) out[key] = ''
  }
  return out
}

export async function getLatestAppStateUpdatedAt(): Promise<string> {
  try {
    const prismaLatest = process.env.NODE_ENV === 'test' || !readsPrismaState()
      ? ''
      : await getLatestPrismaStateUpdatedAt()
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

/** Changed collection names only — never reconstruct multi-megabyte payloads. */
export async function loadChangedStoreKeysSince(
  sinceUpdatedAt: string,
  keys?: string[],
): Promise<{
  keys: string[]
  latestUpdatedAt: string
  /** When each changed key last changed — lets clients skip copies they already hold. */
  changedAt: Record<string, string>
}> {
  try {
    const wanted = keys?.filter(Boolean)
    const projected = process.env.NODE_ENV === 'test' || !readsPrismaState()
      ? { keys: [] as string[], latestUpdatedAt: sinceUpdatedAt, changedAt: {} as Record<string, string> }
      : await getPrismaStateChangedKeysSince(sinceUpdatedAt, wanted)
    await ensureTable()
    const { rows } = wanted?.length
      ? await sql`
          SELECT key, updated_at
          FROM app_state
          WHERE updated_at > ${sinceUpdatedAt}
            AND key = ANY(${wanted})
          ORDER BY updated_at ASC
        `
      : await sql`
          SELECT key, updated_at
          FROM app_state
          WHERE updated_at > ${sinceUpdatedAt}
          ORDER BY updated_at ASC
        `
    const legacyRows = rows as { key: string; updated_at: string }[]
    const changed = [...new Set([...projected.keys, ...legacyRows.map(row => row.key)])]
    if (!changed.length) return { keys: [], latestUpdatedAt: sinceUpdatedAt, changedAt: {} }
    const changedAt: Record<string, string> = { ...projected.changedAt }
    for (const row of legacyRows) {
      const prev = changedAt[row.key]
      if (!prev || Date.parse(row.updated_at) > Date.parse(prev)) changedAt[row.key] = row.updated_at
    }

    const legacyLatest = legacyRows.at(-1)?.updated_at ?? sinceUpdatedAt
    const latestUpdatedAt = Date.parse(projected.latestUpdatedAt) >= Date.parse(legacyLatest)
      ? projected.latestUpdatedAt
      : legacyLatest
    return { keys: changed, latestUpdatedAt, changedAt }
  } catch {
    return { keys: [], latestUpdatedAt: sinceUpdatedAt, changedAt: {} }
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

type SaveStoreKeysOptions = {
  /**
   * Keys (or `true` for every key) whose save may intentionally remove more
   * than BULK_DELETE_MAX_REMOVALS records. Without it such a save is refused.
   */
  allowBulkDelete?: boolean | string[]
}

function bulkDeleteAllowed(key: string, opts?: SaveStoreKeysOptions): boolean {
  const allow = opts?.allowBulkDelete
  if (allow === true) return true
  return Array.isArray(allow) && allow.includes(key)
}

/**
 * Refuse whole-collection saves that would delete many records at once.
 * `loadCurrent` is injected so the rule is unit-testable without a database.
 */
export async function assertNoBulkDeletes(
  entries: Record<string, string>,
  loadCurrent: (keys: string[]) => Promise<AppStateMap>,
  opts?: SaveStoreKeysOptions,
): Promise<void> {
  const incomingByKey = new Map<string, unknown[]>()
  for (const [key, raw] of Object.entries(entries)) {
    if (bulkDeleteAllowed(key, opts)) continue
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { continue }
    if (Array.isArray(parsed)) incomingByKey.set(key, parsed)
  }
  if (incomingByKey.size === 0) return
  const current = await loadCurrent([...incomingByKey.keys()])
  for (const [key, incoming] of incomingByKey) {
    const shrink = assessCollectionShrink(current[key], incoming)
    if (shrink.isBulkDelete) throw new BulkDeleteRefusedError(key, shrink)
  }
}

let _storeRecordsTableChecked: boolean | null = null
async function storeRecordsTableExists(): Promise<boolean> {
  if (_storeRecordsTableChecked !== null) return _storeRecordsTableChecked
  try {
    const { rows } = await sql`SELECT to_regclass('public.store_records') IS NOT NULL AS present`
    _storeRecordsTableChecked = Boolean((rows?.[0] as { present?: boolean } | undefined)?.present)
  } catch {
    _storeRecordsTableChecked = false
  }
  if (!_storeRecordsTableChecked) {
    console.warn(
      '[server-store] store_records table is missing; skipping store_records writes. '
      + 'Run `npm run migrate:store-records:safe` (see docs/PRISMA_STATE_CUTOVER.md).',
    )
  }
  return _storeRecordsTableChecked
}

async function writeLegacyAppState(entries: Record<string, string>): Promise<void> {
  await ensureTable()
  const keys = Object.keys(entries)
  const now = new Date().toISOString()
  const values = keys.map(key => entries[key])
  await sql`
    INSERT INTO app_state (key, value, updated_at)
    SELECT k, v, ${now} FROM unnest(${keys}::text[], ${values}::text[]) AS t(k, v)
    ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `
}

export async function saveStoreKeys(
  entries: Record<string, string>,
  opts?: SaveStoreKeysOptions,
): Promise<void> {
  try {
    const frozen = Object.keys(entries).filter(key => FROZEN_STORE_KEYS.has(key))
    if (frozen.length) {
      // Repairs are still saved through this path; they go to the repairs
      // table (synchronously, only the changed rows) instead of the copy.
      const repairs = entries['deed_repairs_v2']
      entries = Object.fromEntries(Object.entries(entries).filter(([key]) => !FROZEN_STORE_KEYS.has(key)))
      if (repairs && process.env.NODE_ENV !== 'test') {
        await import('./repair-mirror')
          .then(m => m.mirrorRepairsToPrisma(repairs))
          .catch(err => console.error('[repair-mirror] save failed:', err))
      }
      await notifyStoreKeysChanged(frozen)
    }
    // Binary payloads stay outside the database.
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
      await writeLegacyAppState(structuredEntries)
    } else {
      // Absence from a whole-collection save is not a delete. Refuse saves
      // that would drop many records (paginated / partial client state).
      await assertNoBulkDeletes(structuredEntries, loadAppStateForWrite, opts)

      const backend = storeBackend()
      if (writesLegacyAppState(backend)) {
        await writeLegacyAppState(structuredEntries)
      }
      if (writesPrismaState(backend)) {
        await savePrismaStateEntries(structuredEntries)
        if (await storeRecordsTableExists()) {
          await import('./prisma-store')
            .then(m => m.writeStoreRecords(structuredEntries))
            .catch(err => console.error('[server-store] store_records write failed:', err))
        }
      }
      // Wake SSE listeners on the existing LISTEN channel.
      await sql`SELECT pg_notify('app_state_changed', ${keys.join(',')})`.catch(() => null)
    }

    // Accounting / inventory dual-write mirrors — NEVER delete app_state keys.
    if (process.env.NODE_ENV !== 'test') {
      if (entries['deed_stockReservations']) {
        void import('./inventory/reservation-mirror')
          .then(m => m.mirrorStockReservationsToPrisma(entries['deed_stockReservations']))
          .catch(err => console.error('[reservation-mirror] sync write failed:', err))
      }
      if (entries['deed_deliveries']) {
        void import('./delivery-mirror')
          .then(async m => {
            const parsed = JSON.parse(entries['deed_deliveries'] || '[]')
            if (!Array.isArray(parsed)) return
            await m.mirrorDeliveriesToPrisma(parsed)
          })
          .catch(err => console.error('[delivery-mirror] sync write failed:', err))
      }
      const extraMirrors = ['deed_purchaseOrders', 'deed_serials', 'deed_stockMoves', 'deed_receipts'] as const
      if (extraMirrors.some(key => entries[key])) {
        void import('./blob-transfer')
          .then(async m => {
            for (const key of extraMirrors) {
              if (entries[key]) await m.mirrorKnownDomain(key, entries[key], null)
            }
          })
          .catch(err => console.error('[blob-transfer] mirror write failed:', err))
      }
    }
  } catch (err) {
    console.error('[server-store] saveStoreKeys error:', err)
    // Database-free unit fixtures historically exercise best-effort broadcasts.
    // Runtime saves fail closed so callers cannot report success without a commit.
    if (process.env.NODE_ENV !== 'test') throw err
  }
}
