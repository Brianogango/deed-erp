#!/usr/bin/env node
/**
 * Reverse the duplicate receipt journals approved on 2026-10-04 (11 entries,
 * KES 70,500 in total) for INV/2026/0161, 0164, 0168, 0178, 0188, 0199, 0240.
 *
 *   node scripts/reverse-duplicate-receipts.mjs            # dry run, changes nothing
 *   node scripts/reverse-duplicate-receipts.mjs --apply    # reverse them
 *
 * Thin caller for /api/accounting/reverse-duplicate-receipts: the server
 * reverses each journal with the app's own reverseJournalEntry, dated today,
 * and keeps the original. Each item must match exactly one live journal of the
 * stated amount, and no invoice is left without a live receipt journal.
 * The internal secret is read from .env and never printed.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PATH = '/api/accounting/reverse-duplicate-receipts'
const ITEMS = [
  ['INV/2026/0161', '75e7268a', 1000], ['INV/2026/0161', '5b78f068', 1000], ['INV/2026/0161', '53dc16c9', 3000],
  ['INV/2026/0164', 'd6ca8d3b', 2000],
  ['INV/2026/0168', '729127e5', 4500],
  ['INV/2026/0178', '3df0d6ca', 39000],
  ['INV/2026/0188', 'ff797f9b', 6000], ['INV/2026/0188', 'e4840e2c', 6000],
  ['INV/2026/0199', '0a0de41e', 4000],
  ['INV/2026/0240', '0d3500e0', 2000], ['INV/2026/0240', 'e8ead368', 2000],
].map(([invoiceNumber, idPrefix, expectAmount]) => ({ invoiceNumber, idPrefix, expectAmount }))

const apply = process.argv.includes('--apply')
const fail = m => { console.error(`\n  ${m}\n`); process.exit(1) }

let raw
try { raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8') } catch { fail('Could not read .env; run from /var/www/deed-erp.') }
const env = new Map()
for (const line of raw.split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) env.set(m[1], m[2].replace(/^["']|["']$/g, '')) }
const secret = env.get('INTERNAL_API_SECRET')
if (!secret) fail('INTERNAL_API_SECRET is not set in .env.')

const ports = [...new Set([env.get('PORT'), '3000', '3001', '8080'].filter(Boolean))]
const endpoints = process.env.REPOST_ENDPOINT ? [process.env.REPOST_ENDPOINT] : ports.map(p => `http://127.0.0.1:${p}${PATH}`)
const body = JSON.stringify({ apply, items: ITEMS })
let data = null
const tried = []
for (const url of endpoints) {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'x-internal-secret': secret, 'Content-Type': 'application/json' }, body })
    if (res.status === 403) fail(`${url} returned Forbidden: INTERNAL_API_SECRET does not match the running app. Run: sudo -u deedapp pm2 reload deed-erp`)
    if (res.status === 404) { tried.push(`${url} 404 (this build predates the route; deploy first)`); continue }
    if (!res.ok) { tried.push(`${url} HTTP ${res.status}`); continue }
    data = await res.json(); break
  } catch (e) { tried.push(`${url} ${e?.cause?.code ?? e?.message}`) }
}
if (!data) fail(`Could not reach the app:\n    ${tried.join('\n    ')}`)

console.log(`\n  ${apply ? 'APPLIED' : 'DRY RUN'}\n`)
for (const r of data.results) {
  console.log(`    ${r.invoiceNumber.padEnd(14)} ${String(r.amount ?? '').padStart(8)}  ${r.date ?? ''.padEnd(10)}  ${r.outcome.padEnd(13)} ${r.detail ?? ''}`)
}
console.log(`\n  ${apply ? 'Reversed' : 'Would reverse'} KES ${Number(data.total).toLocaleString('en-KE')}\n`)
if (!apply) console.log('  Nothing changed. Re-run with --apply to reverse them.\n')
