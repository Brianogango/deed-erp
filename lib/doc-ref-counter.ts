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

export type DocKind =
  | 'quote'
  | 'quotation'
  | 'invoice'
  | 'sale_order'
  | 'client'
  | 'purchase_order'
  | 'delivery_note'
  | 'credit_note'
  | 'vendor_bill'
  | 'receipt'
  | 'payment_receipt'
  | 'reconfiguration'
  | 'pos'
  /** Delivery jobs (DJB/NNNN) — yearless like POS; jobs are blob-backed, so the atomic counter row is the uniqueness mechanism. */
  | 'delivery_job'
  /** Trade-in buy-backs (BBK/YYYY/NNNN) and client exchanges (EXC/YYYY/NNNN). */
  | 'buyback'
  | 'exchange'
  /** Outsource jobs (OUT/NNNN) and vendor payments (OPAY/NNNN) — yearless, as they always were. */
  | 'outsource'
  | 'outsource_payment'
  /** Rider weekly pay (RWP/NNNN), yearless. */
  | 'rider_pay'
  /** Expense claims (EXP/NNNN), yearless. */
  | 'expense'
  /** CRM deals (OPP/NNNN), yearless. */
  | 'opportunity'
  /** Customer contracts (CTR/NNNN), yearless. */
  | 'contract'
  /** Kilimall orders (KO/NNNN), dispatches (KD/NNNN) and settlements (KS/NNNN), yearless. */
  | 'kilimall_order'
  | 'kilimall_dispatch'
  | 'kilimall_settlement'

// Quotations exist both as CRM quotes and as quotation-state sale orders;
// they share the QUO prefix and therefore one sequence.
export const DOC_PREFIX: Record<DocKind, string> = {
  quote: 'QUO',
  quotation: 'QUO',
  invoice: 'INV',
  sale_order: 'SO',
  client: 'CLT',
  purchase_order: 'PO',
  delivery_note: 'DN',
  credit_note: 'CN',
  vendor_bill: 'BILL',
  receipt: 'REC',
  payment_receipt: 'RCT',
  reconfiguration: 'RCF',
  pos: 'POS',
  delivery_job: 'DJB',
  buyback: 'BBK',
  exchange: 'EXC',
  outsource: 'OUT',
  outsource_payment: 'OPAY',
  rider_pay: 'RWP',
  expense: 'EXP',
  opportunity: 'OPP',
  contract: 'CTR',
  kilimall_order: 'KO',
  kilimall_dispatch: 'KD',
  kilimall_settlement: 'KS',
}

const PREFIX = DOC_PREFIX

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

/** Highest POS/NNNN (no year) among till tickets in the blob. */
async function maxLegacySeqFromAppStateBlob(key: string, prefix: string): Promise<number> {
  try {
    const { rows } = await sql`SELECT value FROM app_state WHERE key = ${key}`
    const raw = rows?.[0]?.value
    if (!raw || typeof raw !== 'string') return 0
    const items = JSON.parse(raw)
    if (!Array.isArray(items)) return 0
    const re = new RegExp(`^${prefix}/(\\d+)$`)
    let max = 0
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const ref = String((item as Record<string, unknown>).ref ?? '')
      const m = re.exec(ref)
      if (!m) continue
      const n = parseInt(m[1], 10)
      if (Number.isFinite(n) && n > max) max = n
    }
    return max
  } catch {
    return 0
  }
}

/**
 * Highest PREFIX/NNNN among a collection's records. Collections are kept one
 * row per record (erp_state_records) now; the older single copy (app_state)
 * is read too, so numbering continues from whichever holds the higher one.
 */
async function maxYearlessSeq(key: string, prefix: string): Promise<number> {
  let fromRecords = 0
  try {
    const re = `^${prefix}/[0-9]+$`
    const { rows } = await sql`
      SELECT COALESCE(MAX((substring(payload->>'ref' from '[0-9]+$'))::int), 0) AS max_num
      FROM erp_state_records WHERE key = ${key} AND payload->>'ref' ~ ${re}`
    fromRecords = Number(rows?.[0]?.max_num ?? 0)
  } catch {
    fromRecords = 0
  }
  return Math.max(fromRecords, await maxLegacySeqFromAppStateBlob(key, prefix))
}

/** Scan an app_state JSON array blob for the highest PREFIX/YYYY/NNNN ref. */
async function maxRefFromAppStateBlob(
  key: string,
  extractRef: (item: Record<string, unknown>) => string | undefined,
  prefix: string,
  year: number,
): Promise<number> {
  try {
    const { rows } = await sql`SELECT value FROM app_state WHERE key = ${key}`
    const raw = rows?.[0]?.value
    if (!raw || typeof raw !== 'string') return 0
    const items = JSON.parse(raw)
    if (!Array.isArray(items)) return 0
    const re = new RegExp(`^${prefix}/${year}/(\\d+)$`)
    let max = 0
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const ref = extractRef(item as Record<string, unknown>)
      const m = ref ? re.exec(ref) : null
      if (m) {
        const n = parseInt(m[1], 10)
        if (Number.isFinite(n) && n > max) max = n
      }
    }
    return max
  } catch {
    return 0
  }
}

/** Highest sequence among existing documents for this prefix (and year, for per-year kinds). */
async function seedFromExisting(kind: DocKind, year: number): Promise<number> {
  try {
    let rows: Record<string, unknown>[]
    if (kind === 'client') {
      ({ rows } = await sql`SELECT COALESCE(MAX((substring(client_number from '[0-9]+$'))::int), 0) AS max_num FROM clients WHERE client_number ~ '^CLT-[0-9]+$'`)
      return Number(rows?.[0]?.max_num ?? 0)
    }
    const prefix = PREFIX[kind]
    const pattern = `^${prefix}/${year}/[0-9]+$`
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
      case 'purchase_order':
        return maxRefFromAppStateBlob('deed_purchaseOrders', i => String(i.ref ?? ''), prefix, year)
      case 'delivery_note':
        return maxRefFromAppStateBlob('deed_deliveries', i => String(i.ref ?? ''), prefix, year)
      case 'receipt':
        return maxRefFromAppStateBlob('deed_receipts', i => String(i.ref ?? ''), prefix, year)
      case 'payment_receipt':
        return maxRefFromAppStateBlob('deed_payments', i => String(i.receiptNumber ?? i.ref ?? ''), prefix, year)
      case 'credit_note':
        return Math.max(
          await maxRefFromAppStateBlob('deed_customerCredits', i => String(i.ref ?? ''), prefix, year),
          await maxRefFromAppStateBlob('deed_invoices', i => {
            const ref = String(i.ref ?? i.invoiceNumber ?? '')
            return ref.startsWith('CN/') ? ref : undefined
          }, prefix, year),
        )
      case 'vendor_bill': {
        const fromInvoices = await maxRefFromAppStateBlob('deed_invoices', i => {
          const ref = String(i.ref ?? i.invoiceNumber ?? '')
          const type = String(i.type ?? '')
          return ref.startsWith('BILL/') || type === 'vendor_bill' ? ref : undefined
        }, prefix, year)
        try {
          ({ rows } = await sql`SELECT COALESCE(MAX((substring(invoice_number from '[0-9]+$'))::int), 0) AS max_num FROM invoices WHERE invoice_number ~ ${pattern}`)
          return Math.max(fromInvoices, Number(rows?.[0]?.max_num ?? 0))
        } catch {
          return fromInvoices
        }
      }
      case 'reconfiguration':
        try {
          ({ rows } = await sql`SELECT COALESCE(MAX((substring(ref from '[0-9]+$'))::int), 0) AS max_num FROM reconfiguration_work_orders WHERE ref ~ ${pattern}`)
          return Number(rows?.[0]?.max_num ?? 0)
        } catch {
          return 0
        }
      case 'pos':
        return maxLegacySeqFromAppStateBlob('deed_posOrders', prefix)
      case 'delivery_job':
        return maxLegacySeqFromAppStateBlob('deed_deliveryJobs', prefix)
      case 'buyback':
        return maxRefFromAppStateBlob('deed_buyBacks', i => String(i.ref ?? ''), prefix, year)
      case 'exchange':
        return maxRefFromAppStateBlob('deed_clientExchanges', i => String(i.ref ?? ''), prefix, year)
      case 'outsource':
        return maxYearlessSeq('deed_outsourceJobs', prefix)
      case 'outsource_payment':
        return maxYearlessSeq('deed_outsourcePayments', prefix)
      case 'rider_pay':
        return maxYearlessSeq('deed_riderWeeklyPays', prefix)
      case 'expense':
        return maxYearlessSeq('deed_expenses', prefix)
      case 'opportunity':
        return maxYearlessSeq('deed_opportunities', prefix)
      case 'contract':
        return maxYearlessSeq('deed_customerContracts', prefix)
      case 'kilimall_order':
        return maxYearlessSeq('deed_kilimallOrders', prefix)
      case 'kilimall_dispatch':
        return maxYearlessSeq('deed_kilimallDispatches', prefix)
      case 'kilimall_settlement':
        return maxYearlessSeq('deed_kilimallSettlements', prefix)
      default:
        return 0
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
  const counterId = kind === 'client' ? 'client_seq' : kind === 'pos' ? 'pos_seq' : kind === 'delivery_job' ? 'djb_seq' : kind === 'outsource' ? 'out_seq' : kind === 'outsource_payment' ? 'opay_seq' : kind === 'rider_pay' ? 'rwp_seq' : kind === 'expense' ? 'exp_seq' : kind === 'opportunity' ? 'opp_seq' : kind === 'contract' ? 'ctr_seq' : kind === 'kilimall_order' ? 'ko_seq' : kind === 'kilimall_dispatch' ? 'kd_seq' : kind === 'kilimall_settlement' ? 'ks_seq' : `${PREFIX[kind]}_${year}`

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
  if (kind === 'pos') return `POS/${String(nextValue).padStart(4, '0')}`
  if (kind === 'delivery_job') return `DJB/${String(nextValue).padStart(4, '0')}`
  if (kind === 'outsource' || kind === 'outsource_payment' || kind === 'rider_pay' || kind === 'expense' || kind === 'opportunity' || kind === 'contract' || kind === 'kilimall_order' || kind === 'kilimall_dispatch' || kind === 'kilimall_settlement') return `${PREFIX[kind]}/${String(nextValue).padStart(4, '0')}`
  return `${PREFIX[kind]}/${year}/${String(nextValue).padStart(4, '0')}`
}
