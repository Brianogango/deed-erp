// Customer invoices whose recorded amountPaid is BELOW the receipts actually
// stored in the payments tables. Raises amountPaid to match; never lowers it.
//
//   node scripts/reconcile-customer-payments.mjs            # report only
//   node scripts/reconcile-customer-payments.mjs --apply    # update
//
// Truth source: payment_allocations (reversed_at IS NULL) joined to payments
// (is_voided = false). Journal text is NOT used to change anything: an invoice
// that the ledger shows paid but that has no stored receipt is only REPORTED
// for a person to check against the bank. Updates the invoices table and the
// deed_invoices projection in one transaction and bumps the key version.

import 'dotenv/config'
import pg from 'pg'

const apply = process.argv.includes('--apply')
const cs = process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!cs) { console.error('Missing database URL env var'); process.exit(1) }
const pool = new pg.Pool({ connectionString: cs })
const c = await pool.connect()

try {
  const rows = (await c.query(`
    WITH alloc AS (
      SELECT a.invoice_id::text AS id, SUM(a.amount) AS received
        FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
       WHERE a.reversed_at IS NULL AND p.is_voided = false
       GROUP BY 1)
    SELECT i.payload->>'id' AS id, i.payload->>'ref' AS ref, i.payload->>'partnerName' AS partner,
           (i.payload->>'total')::numeric AS total,
           COALESCE((i.payload->>'amountPaid')::numeric,0) AS recorded,
           LEAST(alloc.received, (i.payload->>'total')::numeric) AS received,
           COALESCE(t.amount_paid,0) AS table_paid
      FROM erp_state_records i
      JOIN alloc ON alloc.id = i.payload->>'id'
      LEFT JOIN invoices t ON t.id::text = i.payload->>'id'
     WHERE i.key='deed_invoices' AND i.payload->>'type'='customer_invoice' AND i.payload->>'status'='posted'
       AND (LEAST(alloc.received,(i.payload->>'total')::numeric) > COALESCE((i.payload->>'amountPaid')::numeric,0)
         OR LEAST(alloc.received,(i.payload->>'total')::numeric) > COALESCE(t.amount_paid,0))
     ORDER BY 2`)).rows

  console.log(`${rows.length} customer invoice(s) behind their stored receipts:`)
  let sum = 0
  for (const r of rows) {
    sum += Number(r.received) - Math.max(Number(r.recorded), Number(r.table_paid))
    console.log(`  ${String(r.ref).padEnd(16)} ${String(r.partner).slice(0, 28).padEnd(28)} total=${r.total} screen=${r.recorded} table=${r.table_paid} receipts=${r.received}`)
  }
  console.log(`Total to add: ${sum}`)

  // Ledger says paid, but no receipt row exists: report only.
  const orphan = (await c.query(`
    WITH pay AS (
      SELECT substring(j.payload->>'ref' from '(?:REV/)?JRN/PAY/(INV/[0-9]+/[0-9]+)/') AS ref,
             SUM(COALESCE((l->>'credit')::numeric,0)-COALESCE((l->>'debit')::numeric,0)) AS net
        FROM erp_state_records j, LATERAL jsonb_array_elements(j.payload->'lines') l
       WHERE j.key='deed_journalEntries' AND j.payload->>'ref' ~ '^(REV/)?JRN/PAY/INV/[0-9]+/[0-9]+/' AND (l->>'account') LIKE '1800%'
       GROUP BY 1)
    SELECT i.payload->>'ref' AS ref, i.payload->>'partnerName' AS partner, (i.payload->>'total')::numeric AS total,
           COALESCE((i.payload->>'amountPaid')::numeric,0) AS recorded, pay.net AS ledger
      FROM erp_state_records i JOIN pay ON pay.ref = i.payload->>'ref'
     WHERE i.key='deed_invoices' AND i.payload->>'type'='customer_invoice' AND i.payload->>'status'='posted'
       AND pay.net > COALESCE((i.payload->>'amountPaid')::numeric,0)
       AND NOT EXISTS (SELECT 1 FROM payment_allocations a JOIN payments p ON p.id=a.payment_id
                        WHERE a.invoice_id::text = i.payload->>'id' AND a.reversed_at IS NULL AND p.is_voided=false)
     ORDER BY 1`)).rows
  console.log(`\n${orphan.length} invoice(s) the ledger shows paid but with NO stored receipt (not changed; check against the bank):`)
  for (const r of orphan) console.log(`  ${String(r.ref).padEnd(16)} ${String(r.partner).slice(0, 28).padEnd(28)} total=${r.total} screen=${r.recorded} ledger=${r.ledger}`)

  if (!apply) { console.log('\nReport only. Re-run with --apply to raise amountPaid on the first list.'); process.exit(0) }
  if (!rows.length) process.exit(0)
  await c.query('BEGIN')
  for (const r of rows) {
    await c.query(`UPDATE erp_state_records SET payload = jsonb_set(payload,'{amountPaid}',to_jsonb($2::numeric)), updated_at = NOW()
                    WHERE key='deed_invoices' AND payload->>'id'=$1 AND COALESCE((payload->>'amountPaid')::numeric,0) < $2`, [r.id, r.received])
    await c.query(`UPDATE invoices SET amount_paid = $2 WHERE id::text=$1 AND amount_paid < $2`, [r.id, r.received])
  }
  await c.query(`UPDATE erp_state_keys SET version = version + 1, updated_at = NOW() WHERE key='deed_invoices'`)
  await c.query('COMMIT')
  console.log(`Updated ${rows.length} invoice(s).`)
} catch (e) { await c.query('ROLLBACK').catch(() => {}); console.error('Failed, rolled back:', e.message); process.exitCode = 1 }
finally { c.release(); await pool.end() }
