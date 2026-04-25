import 'server-only'
import { sql } from './auth/db'

const ensureTable = async () => {
  await sql`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `
}

export type AppStateMap = Record<string, unknown>

export async function loadAppState(): Promise<AppStateMap> {
  try {
    await ensureTable()
    const { rows } = await sql`SELECT key, value FROM app_state`
    const result: AppStateMap = {}
    for (const row of rows) {
      try { result[row.key] = JSON.parse(row.value) } catch { result[row.key] = row.value }
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
