#!/usr/bin/env node
/**
 * Re-post invoices whose GL journal a stale browser tab reversed.
 *
 * Usage, from /var/www/deed-erp:
 *   node scripts/repost-orphaned-invoices.mjs                    # list only
 *   node scripts/repost-orphaned-invoices.mjs --apply invoice_date
 *   node scripts/repost-orphaned-invoices.mjs --apply today
 *
 * The date argument is required with --apply and there is no default. Posting
 * on each invoice's own date puts the revenue in the month it was earned but
 * reopens a closed period; posting today protects the close and misstates the
 * month. That is a decision for whoever signs the books.
 *
 * This is a thin caller. All the work happens in the API route, which uses the
 * same journal builder as an ordinary Confirm, so revenue, VAT and COGS are
 * recomputed from the invoice rather than typed in by hand.
 *
 * The internal secret is read out of .env here and sent as a header. It is
 * never printed, and it never lands in shell history or in a screenshot of
 * this terminal — which is the whole reason this script exists instead of a
 * curl command carrying a session cookie.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.cwd()
const ENDPOINT = process.env.REPOST_ENDPOINT
  || 'http://127.0.0.1:3000/api/accounting/orphaned-invoice-journals'

function readEnvSecret() {
  let raw
  try {
    raw = readFileSync(resolve(ROOT, '.env'), 'utf8')
  } catch {
    fail('Could not read .env — run this from /var/www/deed-erp.')
  }
  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*INTERNAL_API_SECRET\s*=\s*(.*)\s*$/)
    if (!match) continue
    const value = match[1].trim().replace(/^["']|["']$/g, '')
    if (value) return value
  }
  fail('INTERNAL_API_SECRET is not set in .env. Add one, restart the app, and re-run.')
}

function fail(message) {
  console.error(`\n  ${message}\n`)
  process.exit(1)
}

const money = n => Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2 })

async function main() {
  const applyIndex = process.argv.indexOf('--apply')
  const entryDate = applyIndex === -1 ? null : process.argv[applyIndex + 1]
  if (applyIndex !== -1 && entryDate !== 'invoice_date' && entryDate !== 'today') {
    fail('--apply needs a date basis: "invoice_date" or "today". See the notes at the top of this file.')
  }

  const secret = readEnvSecret()
  const headers = { 'x-internal-secret': secret, 'Content-Type': 'application/json' }

  const listRes = await fetch(ENDPOINT, { headers })
  if (!listRes.ok) {
    fail(`Listing failed with HTTP ${listRes.status}. Is the app running and the build deployed?`)
  }
  const { count, totalValue, invoices } = await listRes.json()

  if (count === 0) {
    console.log('\n  No orphaned invoices. Every posted invoice has a live GL journal.\n')
    return
  }

  console.log(`\n  ${count} invoice(s) posted in the app but missing from the ledger — KES ${money(totalValue)}\n`)
  for (const inv of invoices) {
    const date = new Date(inv.invoiceDate).toISOString().slice(0, 10)
    console.log(`    ${inv.invoiceNumber}  ${date}  KES ${money(inv.totalAmount)}  paid ${money(inv.amountPaid)}`)
    console.log(`      reversed journal: ${inv.reversedJournalRef ?? '(none found)'}`)
  }

  if (!entryDate) {
    console.log('\n  Nothing changed. Re-run with --apply invoice_date  or  --apply today\n')
    return
  }

  console.log(`\n  Re-posting, journal date: ${entryDate === 'today' ? 'today' : "each invoice's own date"} ...\n`)
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ invoiceIds: invoices.map(i => i.id), entryDate }),
  })
  const body = await res.json()
  if (!res.ok) fail(`Re-post failed with HTTP ${res.status}: ${body?.error ?? 'unknown error'}`)

  for (const r of body.results) {
    if (r.kind === 'reposted') {
      console.log(`    ✓ ${r.invoiceNumber} → ${r.journalRef}  (${r.entryDate})`)
    } else {
      console.log(`    · ${r.invoiceNumber} skipped: ${r.reason}`)
    }
  }
  console.log(`\n  ${body.reposted} re-posted, ${body.skipped} skipped.`)
  console.log('  Re-run without --apply to confirm the list is now empty.\n')
}

main().catch(err => fail(err?.message ?? String(err)))
