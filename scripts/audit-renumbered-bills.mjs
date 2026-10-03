// Read-only: bills whose number changed after posting, and bills posted twice.
//
//   node scripts/audit-renumbered-bills.mjs
//
// Lists (A) bills whose current ref differs from the ref in their posting
// journal(s), and (B) documents that carry more than one live (unreversed)
// posting journal, i.e. a payable booked twice. Reads both the screen-side
// journal list and the server journal_entries table. Changes nothing.

import 'dotenv/config'
import pg from 'pg'

const cs = process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!cs) { console.error('Missing database URL env var'); process.exit(1) }
const pool = new pg.Pool({ connectionString: cs })
try {
  const q = async sql => (await pool.query(sql)).rows
  const journals = await q(`
    SELECT 'screen' AS src, payload->>'ref' AS jref, payload->>'invoiceId' AS invoice_id, payload->>'date' AS date,
           (SELECT COALESCE(SUM((l->>'credit')::numeric),0) FROM jsonb_array_elements(payload->'lines') l WHERE (l->>'account') LIKE '3000%') AS ap
      FROM erp_state_records WHERE key='deed_journalEntries' AND payload->>'ref' ~ '^JRN/BILL/[0-9]+/[0-9]+$'
    UNION ALL
    SELECT 'server', ref, invoice_id::text, entry_date::text, total_credit FROM journal_entries WHERE ref ~ '^JRN/BILL/[0-9]+/[0-9]+$'`)
  const reversed = new Set((await q(`
    SELECT substring(payload->>'ref' from '^REV/(JRN/BILL/[0-9]+/[0-9]+)') AS r FROM erp_state_records WHERE key='deed_journalEntries' AND payload->>'ref' ~ '^REV/JRN/BILL/'
    UNION SELECT substring(ref from '^REV/(JRN/BILL/[0-9]+/[0-9]+)') FROM journal_entries WHERE ref ~ '^REV/JRN/BILL/'`)).map(r => r.r))
  const docs = new Map((await q(`SELECT payload->>'id' AS id, payload->>'ref' AS ref, payload->>'partnerName' AS partner, payload->>'total' AS total FROM erp_state_records WHERE key='deed_invoices'`)).map(d => [d.id, d]))

  const byRef = new Map()
  for (const j of journals) { const e = byRef.get(j.jref) || { ...j, srcs: new Set() }; e.srcs.add(j.src); byRef.set(j.jref, e) }

  const renamed = [], byDoc = new Map()
  for (const j of byRef.values()) {
    const d = docs.get(j.invoice_id)
    if (!d) continue
    if (`JRN/${d.ref}` !== j.jref) renamed.push({ j, d })
    if (!reversed.has(j.jref)) { const a = byDoc.get(j.invoice_id) || []; a.push(j); byDoc.set(j.invoice_id, a) }
  }
  console.log(`A. Bills whose number differs from their posting journal: ${renamed.length}`)
  for (const { j, d } of renamed) console.log(`  now ${d.ref}  journal ${j.jref} (${[...j.srcs].join('+')})  ${d.partner}  total=${d.total}  journalAP=${j.ap}  reversed=${reversed.has(j.jref)}`)
  const dbl = [...byDoc.entries()].filter(([, a]) => a.length > 1)
  console.log(`\nB. Documents with more than one live posting journal (payable booked twice): ${dbl.length}`)
  for (const [id, a] of dbl) { const d = docs.get(id); console.log(`  ${d.ref}  ${d.partner}  total=${d.total}  journals: ${a.map(x => `${x.jref}=${x.ap}`).join(', ')}`) }
  console.log('\nRead-only. Nothing was changed.')
} finally { await pool.end() }
