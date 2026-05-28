import 'server-only'
import { sql } from './auth/db'

async function ensureCounterTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS deposit_ref_counter (
      id TEXT PRIMARY KEY,
      current_value INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `
}

export async function getNextDepositRef(): Promise<string> {
  await ensureCounterTable()
  const now = new Date().toISOString()
  const result = await sql`
    INSERT INTO deposit_ref_counter (id, current_value, updated_at)
    VALUES ('dep_ref_seq', 1, ${now})
    ON CONFLICT(id) DO UPDATE SET
      current_value = deposit_ref_counter.current_value + 1,
      updated_at = ${now}
    RETURNING current_value
  `
  if (!result.rows || result.rows.length === 0) {
    throw new Error('Failed to increment deposit ref counter')
  }
  const next = result.rows[0].current_value as number
  return `DEP/${String(next).padStart(4, '0')}`
}
