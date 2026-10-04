// Read-only: for every BILL journal whose bill record no longer exists, show
// what the journal still knows so the bill can be rebuilt.
//
//   node scripts/preview-missing-bills.mjs
//
// Never writes.

import 'dotenv/config'
import pg from 'pg'

const cs = process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!cs) { console.error('Missing database URL env var'); process.exit(1) }
const pool = new pg.Pool({ connectionString: cs })

try {
  const { rows } = await pool.query(`
    WITH docs AS (SELECT payload->>'ref' AS ref FROM erp_state_records WHERE key='deed_invoices'),
    j AS (
      SELECT payload FROM erp_state_records
       WHERE key='deed_journalEntries' AND payload->>'ref' ~ '^JRN/BILL/[0-9]+/[0-9]+$'
         AND substring(payload->>'ref' from '^JRN/(BILL/[0-9]+/[0-9]+)$') NOT IN (SELECT ref FROM docs WHERE ref IS NOT NULL))
    SELECT payload->>'ref' AS jref, payload->>'invoiceId' AS invoice_id, payload->>'date' AS date,
           payload->>'description' AS descr, payload->'lines' AS lines
      FROM j ORDER BY 3, 1`)
  const contacts = (await pool.query(`SELECT payload->>'id' AS id, payload->>'name' AS name FROM erp_state_records WHERE key='deed_contacts'`)).rows
  const byName = new Map(contacts.map(c => [String(c.name).trim().toLowerCase(), c.id]))
  const pays = (await pool.query(`
    SELECT substring(payload->>'ref' from '(?:REV/)?JRN/PAY/(BILL/[0-9]+/[0-9]+)/') AS ref,
           SUM(COALESCE((l->>'debit')::numeric,0)-COALESCE((l->>'credit')::numeric,0)) AS net
      FROM erp_state_records j, LATERAL jsonb_array_elements(j.payload->'lines') l
     WHERE j.key='deed_journalEntries' AND j.payload->>'ref' ~ '^(REV/)?JRN/PAY/BILL/[0-9]+/[0-9]+/' AND (l->>'account') LIKE '3000%'
     GROUP BY 1`)).rows
  const paid = new Map(pays.map(p => [p.ref, Number(p.net)]))

  let totalAll = 0, noVendor = 0
  for (const r of rows) {
    const ref = r.jref.replace(/^JRN\//, '')
    const vendor = (r.descr.split(' — ')[1] || '').trim()
    const vendorId = byName.get(vendor.toLowerCase())
    const lines = (r.lines || []).map(l => ({ acct: l.account, d: Number(l.debit) || 0, c: Number(l.credit) || 0 }))
    const total = lines.filter(l => String(l.acct).startsWith('3000')).reduce((s, l) => s + l.c, 0)
    totalAll += total
    if (!vendorId) noVendor++
    console.log(`${ref}  ${r.date}  ${vendor}  total=${total}  paid=${paid.get(ref) || 0}  invoiceId=${r.invoice_id || '-'}  vendorContact=${vendorId ? 'found' : 'NOT FOUND'}`)
    console.log('     ' + lines.map(l => `${l.acct} ${l.d ? 'Dr' + l.d : 'Cr' + l.c}`).join(' | '))
  }
  console.log(`\n${rows.length} bill(s) missing, total payable booked ${totalAll}; vendors not found in Contacts: ${noVendor}`)
  console.log('Read-only. Nothing was changed.')
} finally { await pool.end() }
