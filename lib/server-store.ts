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

export async function loadAppState(keys?: string[]): Promise<AppStateMap> {
  try {
    await ensureTable()
    const wantedKeys = keys?.filter(Boolean)
    const { rows } = wantedKeys?.length
      ? await sql`SELECT key, value FROM app_state WHERE key = ANY(${wantedKeys})`
      : await sql`SELECT key, value FROM app_state`
    const result: AppStateMap = {}
    for (const row of rows) {
      const key = row.key as string
      const value = row.value as string
      try { result[key] = JSON.parse(value) } catch { result[key] = value }
    }
    return result
  } catch {
    return {}
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
