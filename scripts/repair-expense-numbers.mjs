#!/usr/bin/env node
/**
 * Claims that share one EXP number, and the journals they never got.
 *
 * Usage, from /var/www/deed-erp (run it when few people are using Expenses):
 *   node scripts/repair-expense-numbers.mjs                       # list only, changes nothing
 *   node scripts/repair-expense-numbers.mjs --numbers             # step 1: new numbers, no money moves
 *   node scripts/repair-expense-numbers.mjs --journals 2026-09-13 claim_date
 *   node scripts/repair-expense-numbers.mjs --journals 2026-09-13 today
 *
 * Step 2 posts the missing journals for approved / paid claims dated on or
 * after the given date. The date and the date basis have no default: claims
 * from before the books started are in the opening balances, and posting
 * on each claim's own date can reopen a closed month. That is for whoever
 * signs the books. Closed periods are still refused by the server.
 *
 * The internal secret is read from .env and never printed.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.cwd()
const PATH = '/api/accounting/expense-ref-repair'

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
      fail(`Could not reach the app. Tried:\n${tried.map(t => `    ${t}`).join('\n')}\n\n  Find the real port with:  sudo -u deedapp pm2 env 0 | grep -i '^PORT'\n  then re-run with:         REPOST_ENDPOINT=http://127.0.0.1:<port>${PATH} node scripts/repair-expense-numbers.mjs`)
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
const KIND = { approval: 'approval', payment: 'payment', reimbursement: 'reimbursement' }

async function main() {
  const secret = readEnvSecret()
  const headers = { 'x-internal-secret': secret, 'Content-Type': 'application/json' }
  const { endpoint, res } = await resolveEndpoint(headers)
  const { plans } = await res.json()

  const shared = plans.filter(p => p.newRef)
  const missing = plans.filter(p => p.missing.length)
  const sharedRefs = new Set(plans.filter(p => p.newRef).map(p => p.ref))

  console.log(`\n  ${plans.length} claims. ${sharedRefs.size} number(s) on more than one claim; ${shared.length} claim(s) need a new number.`)
  for (const ref of [...sharedRefs].sort()) {
    const group = plans.filter(p => p.ref === ref)
    console.log(`\n    ${ref}`)
    for (const p of group) {
      const owns = Object.entries(p.owned).map(([k, r]) => `${k} ${r}`).join(', ') || 'no journal'
      console.log(`      ${p.newRef ? 'NEW NUMBER' : 'keeps     '}  ${String(p.submittedByName ?? '').padEnd(22)} ${money(p.amount).padStart(10)}  ${p.status.padEnd(10)} ${p.expenseDate ?? ''}  owns: ${owns}${p.uncertain ? '  (matched by number only)' : ''}`)
    }
  }

  const total = missing.reduce((s, p) => s + p.amount, 0)
  console.log(`\n  ${missing.length} approved / paid claim(s) missing journals (claims worth KES ${money(total)}):`)
  for (const p of missing.sort((a, b) => String(a.expenseDate).localeCompare(String(b.expenseDate)))) {
    console.log(`    ${p.ref.padEnd(12)} ${String(p.expenseDate ?? '').padEnd(10)} ${String(p.submittedByName ?? '').padEnd(22)} ${money(p.amount).padStart(10)}  ${p.status.padEnd(10)} missing: ${p.missing.map(k => KIND[k]).join(', ')}`)
  }

  const argv = process.argv.slice(2)
  if (argv.includes('--numbers')) {
    const r = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ step: 'numbers' }) })
    const body = await r.json()
    if (!r.ok) fail(body.error ?? `HTTP ${r.status}`)
    console.log(`\n  Renumbered ${body.renumbered.length} claim(s):`)
    for (const c of body.renumbered) console.log(`    ${c.from} -> ${c.to}`)
    console.log('\n  Ask everyone with Expenses open to reload the page. Then run the list again before step 2.\n')
    return
  }
  const j = argv.indexOf('--journals')
  if (j !== -1) {
    const since = argv[j + 1]
    const entryDate = argv[j + 2]
    if (!/^\d{4}-\d{2}-\d{2}$/.test(since ?? '') || !['claim_date', 'today'].includes(entryDate)) {
      fail('--journals needs a start date and a date basis, e.g.  --journals 2026-09-13 claim_date')
    }
    const r = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ step: 'journals', since, entryDate }) })
    const body = await r.json()
    if (!r.ok) fail(body.error ?? `HTTP ${r.status}`)
    const ok = body.posted.filter(o => o.ok)
    const bad = body.posted.filter(o => !o.ok)
    console.log(`\n  Posted ${ok.length} journal(s).`)
    for (const o of ok) console.log(`    ${o.ref} ${o.kind} -> ${o.journalRef ?? ''}`)
    if (bad.length) {
      console.log(`\n  Not posted (${bad.length}):`)
      for (const o of bad) console.log(`    ${o.ref} ${o.kind}: ${o.error}`)
    }
    console.log('')
    return
  }
  console.log('\n  Nothing changed. Step 1: --numbers   Step 2: --journals <since YYYY-MM-DD> <claim_date|today>\n')
}

main().catch(err => fail(err?.message ?? String(err)))
