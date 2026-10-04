// Read-only audit: do the invoice/bill records agree with the ledger?
//
//   node scripts/audit-ledger-vs-documents.mjs
//
// Never writes. Reports four things:
//   A. Journals that reference a bill/invoice ref with no matching document
//   B. Posted documents that have no posting journal
//   C. Customer invoices whose amountPaid is below receipts in the ledger
//   D. Vendor bills whose amountPaid is below payments in the ledger

import 'dotenv/config'
import pg from 'pg'

const cs = process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!cs) { console.error('Missing database URL env var'); process.exit(1) }
const pool = new pg.Pool({ connectionString: cs })
const show = (title, rows, fmt) => {
  console.log(`\n${title}: ${rows.length}`)
  for (const r of rows.slice(0, 60)) console.log('  ' + fmt(r))
  if (rows.length > 60) console.log(`  … and ${rows.length - 60} more`)
}

try {
  // A. posting journals whose document ref does not exist
  const a = await pool.query(`
    WITH docs AS (SELECT payload->>'ref' AS ref FROM erp_state_records WHERE key='deed_invoices')
    SELECT DISTINCT substring(j.payload->>'ref' from '^(?:REV/)?JRN/((?:BILL|INV)/[0-9]+/[0-9]+)$') AS doc_ref,
           j.payload->>'date' AS date, left(j.payload->>'description', 60) AS descr
      FROM erp_state_records j
     WHERE j.key='deed_journalEntries'
       AND j.payload->>'ref' ~ '^JRN/(BILL|INV)/[0-9]+/[0-9]+$'
       AND substring(j.payload->>'ref' from '^JRN/((?:BILL|INV)/[0-9]+/[0-9]+)$') NOT IN (SELECT ref FROM docs WHERE ref IS NOT NULL)
     ORDER BY 2 DESC`)
  show('A. Journals with NO matching bill/invoice (document missing)', a.rows, r => `${r.doc_ref}  ${r.date}  ${r.descr}`)

  // B. posted documents without a posting journal
  const b = await pool.query(`
    WITH j AS (SELECT payload->>'ref' AS ref FROM erp_state_records WHERE key='deed_journalEntries')
    SELECT i.payload->>'ref' AS ref, i.payload->>'type' AS type, i.payload->>'date' AS date,
           i.payload->>'partnerName' AS partner, i.payload->>'total' AS total
      FROM erp_state_records i
     WHERE i.key='deed_invoices' AND i.payload->>'status'='posted'
       AND ('JRN/' || (i.payload->>'ref')) NOT IN (SELECT ref FROM j WHERE ref IS NOT NULL)
     ORDER BY 3 DESC`)
  show('B. Posted documents with NO posting journal', b.rows, r => `${String(r.ref).padEnd(18)} ${String(r.type).padEnd(16)} ${r.date}  ${String(r.partner).slice(0, 30)}  total=${r.total}`)

  // C/D. paid amount behind the ledger (customer: AR 1800 credits; bill: AP 3000 debits)
  const paid = async (docPattern, acct, sign, type) => (await pool.query(`
    WITH pay AS (
      SELECT substring(j.payload->>'ref' from '(?:REV/)?JRN/PAY/(${docPattern})/') AS doc_ref,
             SUM(${sign}) AS net
        FROM erp_state_records j, LATERAL jsonb_array_elements(j.payload->'lines') l
       WHERE j.key='deed_journalEntries' AND j.payload->>'ref' ~ '^(REV/)?JRN/PAY/${docPattern}/'
         AND (l->>'account') LIKE '${acct}%'
       GROUP BY 1)
    SELECT i.payload->>'ref' AS ref, i.payload->>'partnerName' AS partner,
           (i.payload->>'total')::numeric AS total,
           COALESCE((i.payload->>'amountPaid')::numeric,0) AS recorded,
           LEAST(pay.net,(i.payload->>'total')::numeric) AS ledger
      FROM erp_state_records i JOIN pay ON pay.doc_ref = i.payload->>'ref'
     WHERE i.key='deed_invoices' AND i.payload->>'type'='${type}' AND i.payload->>'status'='posted'
       AND LEAST(pay.net,(i.payload->>'total')::numeric) > COALESCE((i.payload->>'amountPaid')::numeric,0)
     ORDER BY 1`)).rows
  const dBills = await paid('BILL/[0-9]+/[0-9]+', '3000', `COALESCE((l->>'debit')::numeric,0)-COALESCE((l->>'credit')::numeric,0)`, 'vendor_bill')
  const cInv = await paid('INV/[0-9]+/[0-9]+', '1800', `COALESCE((l->>'credit')::numeric,0)-COALESCE((l->>'debit')::numeric,0)`, 'customer_invoice')
  const fmt = r => `${String(r.ref).padEnd(18)} ${String(r.partner).slice(0, 30).padEnd(30)} total=${r.total} recorded=${r.recorded} ledger=${r.ledger}`
  show('C. Customer invoices paid per ledger but unpaid on the record', cInv, fmt)
  show('D. Vendor bills paid per ledger but unpaid on the record', dBills, fmt)
  console.log('\nRead-only. Nothing was changed.')
} finally { await pool.end() }
