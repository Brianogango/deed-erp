import 'server-only'
import { sql } from './auth/db'

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
    return rowsToAppState(rows as { key: string; value: string }[])
  } catch {
    return {}
  }
}

export async function loadInitialAppState(): Promise<AppStateMap> {
  try {
    await ensureTable()
    const excludedKeyPatterns = ['expense_receipt_%', 'repair_photos_%']
    const { rows } = await sql`
      SELECT key, value
      FROM app_state
      WHERE key NOT LIKE ${excludedKeyPatterns[0]}
        AND key NOT LIKE ${excludedKeyPatterns[1]}
    `
    return rowsToAppState(rows as { key: string; value: string }[])
  } catch {
    return {}
  }
}

export async function getLatestAppStateUpdatedAt(): Promise<string> {
  try {
    await ensureTable()
    const { rows } = await sql`
      SELECT COALESCE(MAX(updated_at), '') AS updated_at
      FROM app_state
    `
    return String((rows?.[0] as { updated_at?: string } | undefined)?.updated_at ?? '')
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
    return { changes, latestUpdatedAt }
  } catch {
    return { changes: {}, latestUpdatedAt: sinceUpdatedAt }
  }
}

export async function saveStoreKeys(entries: Record<string, string>): Promise<void> {
  try {
    await ensureTable()
    const now = new Date().toISOString()
    for (const [key, value] of Object.entries(entries)) {
      await sql`
        INSERT INTO app_state (key, value, updated_at) VALUES (${key}, ${value}, ${now}) 
        ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `
    }
  } catch (err) {
    console.error('[server-store] saveStoreKeys error:', err)
  }
}
