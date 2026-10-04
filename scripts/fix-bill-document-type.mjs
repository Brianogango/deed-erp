// Vendor bills whose invoices-table document_type says 'customer_invoice'.
//
//   node scripts/fix-bill-document-type.mjs            # DRY RUN: list only
//   node scripts/fix-bill-document-type.mjs --apply    # relabel to vendor_bill
//
// The server-built reports (receivables ageing, dashboard, AR/AP split) read
// document_type, so these bills count as receivables and are missing from
// payables. Only rows whose deed_invoices store copy ALSO says vendor_bill are
// changed. No journals and no amounts are touched.

import 'dotenv/config'
import pg from 'pg'

const apply = process.argv.includes('--apply')
const cs = process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!cs) { console.error('Missing database URL env var'); process.exit(1) }
const pool = new pg.Pool({ connectionString: cs })
try {
  const rows = (await pool.query(`
    SELECT t.id, t.invoice_number, t.status, t.total_amount, t.amount_paid
      FROM invoices t
      JOIN erp_state_records s ON s.key='deed_invoices' AND s.payload->>'id' = t.id::text
     WHERE t.document_type = 'customer_invoice' AND s.payload->>'type' = 'vendor_bill'
     ORDER BY t.invoice_number`)).rows
  const others = (await pool.query(`
    SELECT count(*) AS n FROM invoices t
     WHERE t.document_type='customer_invoice' AND t.invoice_number LIKE 'BILL/%'
       AND NOT EXISTS (SELECT 1 FROM erp_state_records s WHERE s.key='deed_invoices' AND s.payload->>'id'=t.id::text AND s.payload->>'type'='vendor_bill')`)).rows[0].n
  let sum = 0
  for (const r of rows) { sum += Number(r.total_amount); console.log(`  ${r.invoice_number.padEnd(16)} ${String(r.status).padEnd(9)} total=${r.total_amount} paid=${r.amount_paid}`) }
  console.log(`\n${rows.length} bill(s) labelled customer_invoice in the table, total ${sum.toFixed(2)}.`)
  console.log(`${others} further BILL/ row(s) skipped because the store copy does not say vendor_bill.`)
  if (!apply) { console.log('\nDRY RUN. Re-run with --apply to relabel them as vendor_bill.'); process.exit(0) }
  const res = await pool.query(`UPDATE invoices SET document_type='vendor_bill' WHERE id = ANY($1::uuid[]) AND document_type='customer_invoice'`, [rows.map(r => r.id)])
  console.log(`Relabelled ${res.rowCount} bill(s).`)
} finally { await pool.end() }
