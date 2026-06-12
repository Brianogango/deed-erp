import 'server-only'
import { sql } from './auth/db'

async function ensureCounterTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS orc_ref_counter (
      id TEXT PRIMARY KEY,
      current_value INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `
}

export async function getNextOrcRef(): Promise<string> {
  await ensureCounterTable()
  const now = new Date().toISOString()
  const result = await sql`
    INSERT INTO orc_ref_counter (id, current_value, updated_at)
    VALUES ('orc_ref_seq', 1, ${now})
    ON CONFLICT(id) DO UPDATE SET
      current_value = orc_ref_counter.current_value + 1,
      updated_at = ${now}
    RETURNING current_value
  `
  if (!result.rows || result.rows.length === 0) {
    throw new Error('Failed to increment ORC ref counter')
  }
  const next = Number(result.rows[0].current_value)
  return `ORC/${String(next).padStart(4, '0')}`
}
