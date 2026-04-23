import 'server-only'
import { getDatabase } from './auth/db'

const ensureTable = () => {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)
}

export type AppStateMap = Record<string, unknown>

export function loadAppState(): AppStateMap {
  try {
    ensureTable()
    const rows = getDatabase().prepare('SELECT key, value FROM app_state').all() as { key: string; value: string }[]
    const result: AppStateMap = {}
    for (const row of rows) {
      try { result[row.key] = JSON.parse(row.value) } catch { result[row.key] = row.value }
    }
    return result
  } catch {
    return {}
  }
}

export function saveStoreKeys(entries: Record<string, string>): void {
  try {
    ensureTable()
    const stmt = getDatabase().prepare(
      'INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    )
    const now = new Date().toISOString()
    for (const [key, value] of Object.entries(entries)) {
      stmt.run(key, value, now)
    }
  } catch (err) {
    console.error('[server-store] saveStoreKeys error:', err)
  }
}
