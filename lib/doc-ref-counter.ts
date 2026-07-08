import 'server-only'
import { sql } from './auth/db'

/**
 * Atomic server-side document number generator.
 *
 * Replaces the `count(*) + 1` pattern used for quote/invoice/sale-order
 * numbers, which produced duplicate numbers (or unique-constraint crashes)
 * when two documents were created concurrently. Each document kind has a
 * counter row that is incremented atomically; on first use the counter is
 * seeded from the highest existing number so historical documents are
 * respected.
 */

export type DocKind = 'quote' | 'invoice' | 'sale_order' | 'client'

const PREFIX: Record<DocKind, string> = {
  quote: 'QTE',
  invoice: 'INV',
  sale_order: 'SO',
  client: 'CLT',
}

let _tableReady = false
async function ensureCounterTable() {
  if (_tableReady && process.env.NODE_ENV !== 'test') return
  await sql`
    CREATE TABLE IF NOT EXISTS doc_ref_counter (
      id TEXT PRIMARY KEY,
      current_value INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `
  if (process.env.NODE_ENV !== 'test') _tableReady = true
}

/** Highest numeric suffix among existing documents matching `PREFIX-<digits>`. */
async function seedFromExisting(kind: DocKind): Promise<number> {
  try {
    let rows: Record<string, unknown>[]
    switch (kind) {
      case 'quote':
        ({ rows } = await sql`SELECT COALESCE(MAX((substring(quote_number from '[0-9]+$'))::int), 0) AS max_num FROM quotes WHERE quote_number ~ '^QTE-[0-9]+$'`)
        break
      case 'invoice':
        ({ rows } = await sql`SELECT COALESCE(MAX((substring(invoice_number from '[0-9]+$'))::int), 0) AS max_num FROM invoices WHERE invoice_number ~ '^INV-[0-9]+$'`)
        break
      case 'sale_order':
        ({ rows } = await sql`SELECT COALESCE(MAX((substring(order_number from '[0-9]+$'))::int), 0) AS max_num FROM sale_orders WHERE order_number ~ '^SO-[0-9]+$'`)
        break
      case 'client':
        ({ rows } = await sql`SELECT COALESCE(MAX((substring(client_number from '[0-9]+$'))::int), 0) AS max_num FROM clients WHERE client_number ~ '^CLT-[0-9]+$'`)
        break
    }
    return Number(rows?.[0]?.max_num ?? 0)
  } catch {
    return 0
  }
}

/**
 * Get the next unique document number for a kind, e.g. "INV-00042".
 * Atomic and safe for concurrent calls.
 */
export async function getNextDocNumber(kind: DocKind): Promise<string> {
  await ensureCounterTable()
  const now = new Date().toISOString()
  const counterId = `${kind}_seq`

  // Fast path: counter row exists — atomic increment.
  const updated = await sql`
    UPDATE doc_ref_counter
    SET current_value = current_value + 1, updated_at = ${now}
    WHERE id = ${counterId}
    RETURNING current_value
  `
  let nextValue = updated.rows?.[0]?.current_value as number | undefined

  if (nextValue === undefined) {
    // First use: seed from the highest existing number, racing inserts safely.
    const seed = await seedFromExisting(kind)
    const inserted = await sql`
      INSERT INTO doc_ref_counter (id, current_value, updated_at)
      VALUES (${counterId}, ${seed + 1}, ${now})
      ON CONFLICT(id) DO UPDATE SET
        current_value = GREATEST(doc_ref_counter.current_value, ${seed}) + 1,
        updated_at = ${now}
      RETURNING current_value
    `
    nextValue = inserted.rows?.[0]?.current_value as number
  }

  if (!Number.isFinite(nextValue)) throw new Error(`Failed to generate ${kind} number`)
  return `${PREFIX[kind]}-${String(nextValue).padStart(5, '0')}`
}
