// Find vendor bills whose recorded amountPaid is LOWER than the payments the
// ledger shows, and (with --apply) raise amountPaid to match.
//
// A bill payment posts a journal JRN/PAY/<billRef>/<paymentId> that debits
// 3000 Accounts Payable (reversals are REV/JRN/PAY/...). Net payments for a
// bill = sum(debit - credit) on the 3000 account across those entries.
//
//   node scripts/reconcile-bill-payments.mjs            # report only
//   node scripts/reconcile-bill-payments.mjs --apply    # raise amountPaid
//
// Only ever INCREASES amountPaid, capped at the bill total, on posted bills.
// Updates erp_state_records (what the app reads) and invoices.amount_paid in
// one transaction, and bumps the key version so open browsers refresh.

import 'dotenv/config'
import pg from 'pg'

const apply = process.argv.includes('--apply')
const cs = process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!cs) { console.error('Missing database URL env var'); process.exit(1) }
const pool = new pg.Pool({ connectionString: cs })

const SQL = `
WITH pay AS (
  SELECT substring(j.payload->>'ref' from '(?:REV/)?JRN/PAY/(BILL/[0-9]+/[0-9]+)') AS bill_ref,
         COALESCE(SUM(COALESCE((l->>'debit')::numeric,0) - COALESCE((l->>'credit')::numeric,0)),0) AS net
    FROM erp_state_records j,
         LATERAL jsonb_array_elements(j.payload->'lines') l
   WHERE j.key = 'deed_journalEntries'
     AND j.payload->>'ref' ~ '^(REV/)?JRN/PAY/BILL/[0-9]+/[0-9]+/'
     AND (l->>'account') LIKE '3000%'
   GROUP BY 1
)
SELECT i.payload->>'id' AS id, i.payload->>'ref' AS ref, i.payload->>'partnerName' AS partner,
       (i.payload->>'total')::numeric AS total,
       COALESCE((i.payload->>'amountPaid')::numeric,0) AS recorded,
       LEAST(pay.net, (i.payload->>'total')::numeric) AS ledger
  FROM erp_state_records i JOIN pay ON pay.bill_ref = i.payload->>'ref'
 WHERE i.key='deed_invoices' AND i.payload->>'type'='vendor_bill'
   AND i.payload->>'status' = 'posted'
   AND LEAST(pay.net, (i.payload->>'total')::numeric) > COALESCE((i.payload->>'amountPaid')::numeric,0)
 ORDER BY 2`

try {
  const { rows } = await pool.query(SQL)
  console.log(`${rows.length} bill(s) behind the ledger:`)
  let sum = 0
  for (const r of rows) {
    sum += Number(r.ledger) - Number(r.recorded)
    console.log(`  ${r.ref.padEnd(16)} ${String(r.partner).slice(0, 34).padEnd(34)} total=${r.total} recorded=${r.recorded} ledger=${r.ledger}`)
  }
  console.log(`Total to add to amountPaid: ${sum}`)
  if (!apply) { console.log('\nReport only. Re-run with --apply to update.'); process.exit(0) }
  if (!rows.length) process.exit(0)

  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    for (const r of rows) {
      await c.query(
        `UPDATE erp_state_records
            SET payload = jsonb_set(payload, '{amountPaid}', to_jsonb($2::numeric)), updated_at = NOW()
          WHERE key='deed_invoices' AND payload->>'id' = $1`, [r.id, r.ledger])
      await c.query(`UPDATE invoices SET amount_paid = $2 WHERE id::text = $1 AND amount_paid < $2`, [r.id, r.ledger])
    }
    await c.query(`UPDATE erp_state_keys SET version = version + 1, updated_at = NOW() WHERE key='deed_invoices'`)
    await c.query('COMMIT')
    console.log(`Updated ${rows.length} bill(s).`)
  } catch (e) { await c.query('ROLLBACK'); throw e } finally { c.release() }
} finally { await pool.end() }
