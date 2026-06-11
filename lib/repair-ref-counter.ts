import 'server-only'
import { sql } from './auth/db'

/**
 * Server-side atomic repair reference counter.
 * Ensures unique repair references across all users and concurrent requests.
 * Uses a database table to maintain the counter state with atomic increments.
 */

const TABLE_NAME = 'repair_ref_counter'

async function ensureCounterTable() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS repair_ref_counter (
        id TEXT PRIMARY KEY,
        current_value INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )
    `
  } catch (err) {
    console.error('[repair-ref-counter] ensureCounterTable error:', err)
    throw err
  }
}

/**
 * Get the next unique repair reference number.
 * This function is atomic and safe for concurrent calls.
 * Returns a reference like "REP/0001", "REP/0002", etc.
 */
export async function getNextRepairRef(): Promise<string> {
  try {
    await ensureCounterTable()

    const now = new Date().toISOString()
    const counterId = 'repair_ref_seq'

    // Atomic increment: try to update the counter, or insert if it doesn't exist
    const result = await sql`
      INSERT INTO repair_ref_counter (id, current_value, updated_at)
      VALUES (${counterId}, 1, ${now})
      ON CONFLICT(id) DO UPDATE SET
        current_value = repair_ref_counter.current_value + 1,
        updated_at = ${now}
      RETURNING current_value
    `

    if (!result.rows || result.rows.length === 0) {
      throw new Error('Failed to increment repair ref counter')
    }

    const nextValue = result.rows[0].current_value as number
    return `REP/${String(nextValue).padStart(4, '0')}`
  } catch (err) {
    console.error('[repair-ref-counter] getNextRepairRef error:', err)
    throw err
  }
}

/**
 * Reset the counter to a specific value (admin/maintenance only).
 * Use with caution — this should only be called during data migrations or resets.
 */
export async function resetRepairRefCounter(value: number): Promise<void> {
  try {
    await ensureCounterTable()
    const now = new Date().toISOString()
    await sql`
      INSERT INTO repair_ref_counter (id, current_value, updated_at)
      VALUES ('repair_ref_seq', ${value}, ${now})
      ON CONFLICT(id) DO UPDATE SET
        current_value = ${value},
        updated_at = ${now}
    `
  } catch (err) {
    console.error('[repair-ref-counter] resetRepairRefCounter error:', err)
    throw err
  }
}

/**
 * Get the current counter value (for debugging/monitoring).
 */
export async function getCurrentRepairRefCounter(): Promise<number> {
  try {
    await ensureCounterTable()
    const result = await sql`
      SELECT current_value FROM repair_ref_counter
      WHERE id = 'repair_ref_seq'
    `
    return Number(result.rows?.[0]?.current_value ?? 0)
  } catch (err) {
    console.error('[repair-ref-counter] getCurrentRepairRefCounter error:', err)
    return 0
  }
}
