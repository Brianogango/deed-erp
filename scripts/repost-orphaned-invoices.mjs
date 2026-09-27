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
const PATH = '/api/accounting/orphaned-invoice-journals'

let envCache = null
function env() {
  if (envCache) return envCache
  let raw
  try {
    raw = readFileSync(resolve(ROOT, '.env'), 'utf8')
  } catch {
    fail('Could not read .env — run this from /var/www/deed-erp.')
  }
  envCache = new Map()
  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (match) envCache.set(match[1], match[2].replace(/^["']|["']$/g, ''))
  }
  return envCache
}

function readEnvSecret() {
  const value = env().get('INTERNAL_API_SECRET')
  if (value) return value
  fail('INTERNAL_API_SECRET is not set in .env. Add one, restart the app, and re-run.')
}

/**
 * Where the app is listening.
 *
 * Guessing port 3000 and reporting Node's bare "fetch failed" was not good
 * enough — it says nothing about what went wrong. So: the explicit override
 * first, then PORT from .env, then the usual candidates, and finally the public
 * host through nginx, which is reachable even when the local port is not what
 * anyone expected. Each candidate is tried in turn and the failures are
 * reported together if none answer.
 */
function candidateEndpoints() {
  if (process.env.REPOST_ENDPOINT) return [process.env.REPOST_ENDPOINT]
  const ports = []
  const configured = env().get('PORT')
  if (configured) ports.push(configured)
  for (const p of ['3000', '3001', '8080']) if (!ports.includes(p)) ports.push(p)
  return [
    ...ports.map(p => `http://127.0.0.1:${p}${PATH}`),
    `https://erp.deed.co.ke${PATH}`,
  ]
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Still coming up, rather than genuinely wrong. */
const STARTING_UP = new Set(['ECONNREFUSED', 'ECONNRESET', 'UND_ERR_SOCKET'])

async function tryOnce(headers) {
  const tried = []
  let transient = false
  for (const endpoint of candidateEndpoints()) {
    try {
      const res = await fetch(endpoint, { headers })
      if (res.ok) return { endpoint, res, tried, transient }
      if (res.status === 403) {
        fail(`Reached ${endpoint} but it returned Forbidden.\n  The INTERNAL_API_SECRET in .env does not match the one the running app loaded.\n  Restart the app (pm2 reload deed-erp) so it picks up the current .env, then re-run.`)
      }
      if (res.status === 404) {
        tried.push(`${endpoint} — 404, that build predates this route`)
        continue
      }
      // 502/503/504 from nginx mean it has no upstream yet — the app is mid-boot.
      if (res.status >= 502 && res.status <= 504) transient = true
      tried.push(`${endpoint} — HTTP ${res.status}`)
    } catch (err) {
      const code = err?.cause?.code ?? err?.message ?? 'unreachable'
      if (STARTING_UP.has(err?.cause?.code)) transient = true
      tried.push(`${endpoint} — ${code}`)
    }
  }
  return { endpoint: null, res: null, tried, transient }
}

/**
 * Wait for the app rather than racing it.
 *
 * `npm run build` rewrites .next underneath the running server, so the app
 * crash-loops for the length of every build and then needs a few more seconds
 * to boot after pm2 reload — Prisma client generation alone takes about five.
 * Running this script straight after a deploy therefore hits ECONNREFUSED or a
 * 502 from nginx and reports a failure that resolves itself moments later.
 *
 * So a connection refusal or a bad-gateway is treated as "not up yet" and
 * retried for half a minute, while anything that will not fix itself — a 403,
 * a 404 — still fails at once. (The underlying problem is the deploy building
 * on top of the live directory; this only stops the script tripping over it.)
 */
async function resolveEndpoint(headers) {
  const deadline = Date.now() + 30_000
  let announced = false
  for (;;) {
    const { endpoint, res, tried, transient } = await tryOnce(headers)
    if (endpoint) {
      if (announced) console.log('  up.\n')
      return { endpoint, res }
    }
    if (!transient || Date.now() >= deadline) {
      fail(`Could not reach the app. Tried:\n${tried.map(t => `    ${t}`).join('\n')}\n\n  Find the real port with:  sudo -u deedapp pm2 env 0 | grep -i '^PORT'\n  then re-run with:         REPOST_ENDPOINT=http://127.0.0.1:<port>${PATH} node scripts/repost-orphaned-invoices.mjs`)
    }
    if (!announced) {
      process.stdout.write('\n  App is still starting up, waiting ...')
      announced = true
    } else {
      process.stdout.write('.')
    }
    await sleep(2000)
  }
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

  const { endpoint, res: listRes } = await resolveEndpoint(headers)
  const { count, totalValue, invoices } = await listRes.json()

  if (count === 0) {
    console.log('\n  No orphaned invoices. Every posted invoice has a live GL journal.\n')
    return
  }

  console.log(`\n  ${count} invoice(s) whose GL journal was reversed and never replaced — KES ${money(totalValue)}\n`)
  for (const inv of invoices) {
    const date = new Date(inv.invoiceDate).toISOString().slice(0, 10)
    console.log(`    ${inv.invoiceNumber}  ${date}  KES ${money(inv.totalAmount)}  paid ${money(inv.amountPaid)}`)
    console.log(`      reversed journal: ${inv.reversedJournalRef ?? '(none found)'}`)
  }

  // A victim of the un-posting bug always has a reversed journal to point at.
  // A row without one is an invoice that never reached the ledger — almost
  // certainly pre-cutover — and re-posting it would invent revenue the opening
  // balances already carry. The server refuses these individually; refusing the
  // whole run here as well means a future widening of the filter cannot turn
  // into a mass posting just because nobody read the list first.
  const withoutReversal = invoices.filter(i => !i.reversedJournalRef)
  if (withoutReversal.length > 0) {
    fail(
      `${withoutReversal.length} of these have no reversed journal, so they were never un-posted — they never reached the ledger at all.\n`
      + '  Re-posting those would invent revenue. Refusing the whole run.\n'
      + `  First few: ${withoutReversal.slice(0, 5).map(i => i.invoiceNumber).join(', ')}`,
    )
  }

  if (!entryDate) {
    console.log('\n  Nothing changed. Re-run with --apply invoice_date  or  --apply today\n')
    return
  }

  console.log(`\n  Re-posting, journal date: ${entryDate === 'today' ? 'today' : "each invoice's own date"} ...\n`)
  const res = await fetch(endpoint, {
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
