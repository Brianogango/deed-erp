// Rebuild vendor bills whose records are gone but whose posting journal still
// exists (found by audit:ledger-documents / preview:missing-bills).
//
//   node scripts/restore-missing-bills.mjs                 # DRY RUN: does every insert, then rolls back
//   node scripts/restore-missing-bills.mjs --apply         # commit
//   node scripts/restore-missing-bills.mjs --skip=BILL/2026/0035,BILL/2026/0029
//
// Each bill is recreated with its ORIGINAL id and ref, vendor, date, total, one
// line per debited account, and amountPaid taken from the ledger's net bill
// payments. It posts NO journal (the journal already exists) and is linked to
// it. Written to both the invoices table (+ items) and the deed_invoices
// projection, flagged restoredFromJournal. Skips: bills already present, any
// whose journal was reversed, vendors not matched in Contacts/clients.
// Original line descriptions/quantities/PO links are not recoverable.

import 'dotenv/config'
import { randomUUID, createHash } from 'crypto'
import pg from 'pg'

const apply = process.argv.includes('--apply')
const skipArg = process.argv.find(a => a.startsWith('--skip='))
const skip = new Set(skipArg ? skipArg.slice(7).split(',').map(s => s.trim()).filter(Boolean) : [])
const createdByArg = process.argv.find(a => a.startsWith('--created-by='))?.slice(13)
const cs = process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!cs) { console.error('Missing database URL env var'); process.exit(1) }
const pool = new pg.Pool({ connectionString: cs })
const num = v => Number(v) || 0
const KEY = 'deed_invoices'

const c = await pool.connect()
try {
  const createdBy = createdByArg || (await c.query(`SELECT id FROM users WHERE role::text='director' AND is_active ORDER BY created_at LIMIT 1`)).rows[0]?.id
  if (!createdBy) throw new Error('No active director user found; pass --created-by=<user uuid>')

  const journals = (await c.query(`
    WITH docs AS (SELECT payload->>'ref' AS ref FROM erp_state_records WHERE key=$1)
    SELECT payload FROM erp_state_records
     WHERE key='deed_journalEntries' AND payload->>'ref' ~ '^JRN/BILL/[0-9]+/[0-9]+$'
       AND substring(payload->>'ref' from '^JRN/(BILL/[0-9]+/[0-9]+)$') NOT IN (SELECT ref FROM docs WHERE ref IS NOT NULL)
     ORDER BY payload->>'date', payload->>'ref'`, [KEY])).rows.map(r => r.payload)

  const reversed = new Set((await c.query(`
    SELECT substring(payload->>'ref' from '^REV/JRN/(BILL/[0-9]+/[0-9]+)') AS r FROM erp_state_records WHERE key='deed_journalEntries' AND payload->>'ref' ~ '^REV/JRN/BILL/'
    UNION SELECT substring(ref from '^REV/JRN/(BILL/[0-9]+/[0-9]+)') FROM journal_entries WHERE ref ~ '^REV/JRN/BILL/'`)).rows.map(r => r.r))
  const contacts = new Map((await c.query(`SELECT lower(trim(payload->>'name')) AS n, payload->>'id' AS id, payload->>'paymentTermsDays' AS terms FROM erp_state_records WHERE key='deed_contacts'`)).rows.map(r => [r.n, r]))
  const paid = new Map((await c.query(`
    SELECT substring(payload->>'ref' from '(?:REV/)?JRN/PAY/(BILL/[0-9]+/[0-9]+)/') AS ref,
           SUM(COALESCE((l->>'debit')::numeric,0)-COALESCE((l->>'credit')::numeric,0)) AS net
      FROM erp_state_records j, LATERAL jsonb_array_elements(j.payload->'lines') l
     WHERE j.key='deed_journalEntries' AND j.payload->>'ref' ~ '^(REV/)?JRN/PAY/BILL/[0-9]+/[0-9]+/' AND (l->>'account') LIKE '3000%'
     GROUP BY 1`)).rows.map(r => [r.ref, num(r.net)]))

  await c.query('BEGIN')
  await c.query(`INSERT INTO erp_state_keys (key, kind, value, version, created_at, updated_at)
                 VALUES ($1,'collection',NULL,1,NOW(),NOW())
                 ON CONFLICT (key) DO UPDATE SET version = erp_state_keys.version + 1, updated_at = NOW()`, [KEY])
  let pos = (await c.query('SELECT COALESCE(MAX(position),-1) AS m FROM erp_state_records WHERE key=$1', [KEY])).rows[0].m
  let done = 0, sum = 0
  const skipped = []

  for (const j of journals) {
    const ref = j.ref.replace(/^JRN\//, '')
    const vendorName = (String(j.description || '').split(' — ')[1] || '').trim()
    const contact = contacts.get(vendorName.toLowerCase())
    const lines = (j.lines || []).map(l => ({ acct: String(l.account || ''), d: num(l.debit), c: num(l.credit) }))
    const total = lines.filter(l => l.acct.startsWith('3000')).reduce((s, l) => s + l.c, 0)
    const debits = lines.filter(l => l.d > 0)
    const why = skip.has(ref) ? 'in --skip list'
      : reversed.has(ref) ? 'journal was reversed'
      : !contact ? `vendor "${vendorName}" not found in Contacts`
      : !j.invoiceId ? 'journal has no invoiceId'
      : !(total > 0) ? 'no payable amount in journal' : null
    if (why) { skipped.push(`${ref}: ${why}`); continue }
    const clientOk = (await c.query('SELECT 1 FROM clients WHERE id::text=$1', [contact.id])).rowCount
    if (!clientOk) { skipped.push(`${ref}: vendor has no clients row`); continue }
    const exists = (await c.query('SELECT 1 FROM invoices WHERE id::text=$1 OR invoice_number=$2', [j.invoiceId, ref])).rowCount
    if (exists) { skipped.push(`${ref}: already in invoices table`); continue }

    const date = String(j.date).slice(0, 10)
    const terms = Math.max(0, parseInt(contact.terms, 10) || 0)
    const due = new Date(Date.parse(date) + terms * 86400000).toISOString().slice(0, 10)
    const amountPaid = Math.min(Math.max(paid.get(ref) || 0, 0), total)
    const notes = `Restored from ledger journal ${j.ref}; original line detail unavailable.`

    await c.query(`
      INSERT INTO invoices (id, invoice_number, client_id, status, invoice_date, due_date, subtotal, discount_amount, tax_amount,
                            total_amount, amount_paid, notes, document_type, posting_status, posted_at, posted_journal_entry_id,
                            created_by, created_at, updated_at)
      VALUES ($1,$2,$3,'approved',$4,$5,$6,0,0,$6,$7,$8,'vendor_bill','posted',NOW(),
              (SELECT id FROM journal_entries WHERE ref=$9), $10, NOW(), NOW())`,
      [j.invoiceId, ref, contact.id, date, due, total, amountPaid, notes, j.ref, createdBy])

    const clientLines = []
    for (let i = 0; i < debits.length; i++) {
      const d = debits[i]
      const code = /^6\d{3}/.test(d.acct) ? d.acct.slice(0, 4) : null
      const desc = `Restored — ${d.acct}`
      await c.query(`
        INSERT INTO invoice_items (id, invoice_id, description, qty, unit_price, discount_pct, tax_rate, line_subtotal, line_tax,
                                   line_total, taxable_base, sort_order, account_code)
        VALUES (gen_random_uuid(), $1, $2, 1, $3, 0, 0, $3, 0, $3, 0, $4, $5)`, [j.invoiceId, desc, d.d, i, code])
      clientLines.push({ id: randomUUID(), lineType: 'item', description: desc, qty: 1, unitPrice: d.d, taxRate: 0, subtotal: d.d, ...(code ? { accountCode: code } : {}) })
    }
    const payload = {
      id: j.invoiceId, ref, type: 'vendor_bill', status: 'posted', partnerId: contact.id, partnerName: vendorName,
      date, dueDate: due, lines: clientLines, subtotal: total, taxTotal: 0, total, amountPaid, notes,
      currencyCode: 'KES', baseCurrencyCode: 'KES', exchangeRateToBase: 1, restoredFromJournal: true,
    }
    const recordKey = `id:${j.invoiceId}`
    await c.query(`INSERT INTO erp_state_records (id, key, record_key, position, payload, created_at, updated_at)
                   VALUES ($1,$2,$3,$4,$5::jsonb,NOW(),NOW()) ON CONFLICT (key, record_key) DO NOTHING`,
      [`${KEY}:${createHash('sha256').update(recordKey).digest('hex').slice(0, 32)}`, KEY, recordKey, ++pos, JSON.stringify(payload)])
    console.log(`  ${ref}  ${date}  ${vendorName}  total=${total}  paid=${amountPaid}`)
    done++; sum += total
  }

  console.log(`\n${done} bill(s) ${apply ? 'restored' : 'would be restored'}, total ${sum}.`)
  for (const s of skipped) console.log(`  SKIPPED ${s}`)
  if (apply) { await c.query('COMMIT'); console.log('Committed.') }
  else { await c.query('ROLLBACK'); console.log('\nDRY RUN: all inserts succeeded and were rolled back. Re-run with --apply to commit.') }
} catch (e) { await c.query('ROLLBACK').catch(() => {}); console.error('Failed, rolled back:', e.message); process.exitCode = 1 }
finally { c.release(); await pool.end() }
