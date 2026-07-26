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
 *
 * Document kinds use per-calendar-year sequences and produce refs in the
 * standard `{PREFIX}-{YYYY}-{NNNN}` format (counter id `{kind}_{year}_seq`).
 * The `client` kind is not a document and keeps its legacy non-year
 * `CLT-NNNNN` format (counter id `client_seq`).
 */

export type DocKind =
  | 'quote'
  | 'sale_order'
  | 'proforma'
  | 'delivery_note'
  | 'invoice'
  | 'receipt'
  | 'credit_note'
  | 'purchase_order'
  | 'client'

const PREFIX: Record<DocKind, string> = {
  quote: 'QUO',
  sale_order: 'SO',
  proforma: 'PI',
  delivery_note: 'DN',
  invoice: 'INV',
  receipt: 'RCT',
  credit_note: 'CN',
  purchase_order: 'PO',
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

/**
 * Highest numeric suffix among existing documents matching
 * `{PREFIX}-{year}-<digits>` for the current year. Legacy formats
 * (e.g. `QTE-00042`, `INV/0042`) are opaque history and never seed.
 * The `client` kind keeps its legacy `CLT-<digits>` seeding.
 */
async function seedFromExisting(kind: DocKind, year: number): Promise<number> {
  try {
    let rows: Record<string, unknown>[]
    const pattern = `^${PREFIX[kind]}-${year}-[0-9]+$`
    switch (kind) {
      case 'quote':
        ({ rows } = await sql`SELECT COALESCE(MAX((substring(quote_number from '[0-9]+$'))::int), 0) AS max_num FROM quotes WHERE quote_number ~ ${pattern}`)
        break
      case 'invoice':
        ({ rows } = await sql`SELECT COALESCE(MAX((substring(invoice_number from '[0-9]+$'))::int), 0) AS max_num FROM invoices WHERE invoice_number ~ ${pattern}`)
        break
      case 'sale_order':
        ({ rows } = await sql`SELECT COALESCE(MAX((substring(order_number from '[0-9]+$'))::int), 0) AS max_num FROM sale_orders WHERE order_number ~ ${pattern}`)
        break
      case 'delivery_note':
        ({ rows } = await sql`SELECT COALESCE(MAX((substring(dn_number from '[0-9]+$'))::int), 0) AS max_num FROM delivery_notes WHERE dn_number ~ ${pattern}`)
        break
      case 'credit_note':
        ({ rows } = await sql`SELECT COALESCE(MAX((substring(credit_note_number from '[0-9]+$'))::int), 0) AS max_num FROM credit_notes WHERE credit_note_number ~ ${pattern}`)
        break
      case 'purchase_order':
        ({ rows } = await sql`SELECT COALESCE(MAX((substring(po_number from '[0-9]+$'))::int), 0) AS max_num FROM purchase_orders WHERE po_number ~ ${pattern}`)
        break
      case 'proforma':
      case 'receipt':
        // No dedicated table/column stores these refs server-side; start at 1.
        return 0
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
 * Get the next unique document number for a kind, e.g. "INV-2026-0042"
 * (or "CLT-00042" for the non-year `client` kind).
 * Atomic and safe for concurrent calls.
 */
export async function getNextDocNumber(kind: DocKind): Promise<string> {
  await ensureCounterTable()
  const now = new Date().toISOString()
  const year = new Date().getFullYear()
  const counterId = kind === 'client' ? 'client_seq' : `${kind}_${year}_seq`

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
  return `${PREFIX[kind]}-${year}-${String(nextValue).padStart(4, '0')}`
}
