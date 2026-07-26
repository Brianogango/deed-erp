import 'server-only'
import { sql } from './auth/db'

/**
 * Atomic server-side document number generator.
 *
 * Commercial documents use the standard abbreviations (QUO, SO, INV, …) with
 * a separate sequence per document type per calendar year, formatted as
 * `PREFIX/YYYY/NNNN` (e.g. `INV/2026/0042`). Each sequence has a counter row
 * that is incremented atomically; on first use of a year the counter is
 * seeded from the highest existing number for that prefix and year, so
 * historical documents are respected and the sequence restarts every January.
 *
 * Client records are not commercial documents and keep their legacy global
 * `CLT-NNNNN` format.
 */

export type DocKind = 'quote' | 'quotation' | 'invoice' | 'sale_order' | 'client'

// Quotations exist both as CRM quotes and as quotation-state sale orders;
// they share the QUO prefix and therefore one sequence.
const PREFIX: Record<DocKind, string> = {
  quote: 'QUO',
  quotation: 'QUO',
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

/** Highest sequence among existing documents for this prefix (and year, for per-year kinds). */
async function seedFromExisting(kind: DocKind, year: number): Promise<number> {
  try {
    let rows: Record<string, unknown>[]
    if (kind === 'client') {
      ({ rows } = await sql`SELECT COALESCE(MAX((substring(client_number from '[0-9]+$'))::int), 0) AS max_num FROM clients WHERE client_number ~ '^CLT-[0-9]+$'`)
      return Number(rows?.[0]?.max_num ?? 0)
    }
    const pattern = `^${PREFIX[kind]}/${year}/[0-9]+$`
    switch (kind) {
      case 'quote':
      case 'quotation':
        // QUO numbers live in both the quotes and sale_orders tables.
        ({ rows } = await sql`
          SELECT GREATEST(
            COALESCE((SELECT MAX((substring(quote_number from '[0-9]+$'))::int) FROM quotes WHERE quote_number ~ ${pattern}), 0),
            COALESCE((SELECT MAX((substring(order_number from '[0-9]+$'))::int) FROM sale_orders WHERE order_number ~ ${pattern}), 0)
          ) AS max_num`)
        break
      case 'invoice':
        ({ rows } = await sql`SELECT COALESCE(MAX((substring(invoice_number from '[0-9]+$'))::int), 0) AS max_num FROM invoices WHERE invoice_number ~ ${pattern}`)
        break
      case 'sale_order':
        ({ rows } = await sql`SELECT COALESCE(MAX((substring(order_number from '[0-9]+$'))::int), 0) AS max_num FROM sale_orders WHERE order_number ~ ${pattern}`)
        break
    }
    return Number(rows?.[0]?.max_num ?? 0)
  } catch {
    return 0
  }
}

/**
 * Get the next unique document number for a kind, e.g. "INV/2026/0042"
 * (or "CLT-00042" for clients). Atomic and safe for concurrent calls.
 */
export async function getNextDocNumber(kind: DocKind): Promise<string> {
  await ensureCounterTable()
  const now = new Date().toISOString()
  const year = new Date().getFullYear()
  const counterId = kind === 'client' ? 'client_seq' : `${PREFIX[kind]}_${year}`

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
    const seed = await seedFromExisting(kind, year)
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
  if (kind === 'client') return `CLT-${String(nextValue).padStart(5, '0')}`
  return `${PREFIX[kind]}/${year}/${String(nextValue).padStart(4, '0')}`
}
