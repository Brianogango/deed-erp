#!/usr/bin/env node
/**
 * P1-DEED-005 — Read-only report of contacts using the default payment terms
 * (paymentTermsDays === 30 or missing / null).
 *
 * Dry-run only: never mutates data.
 *
 *   node scripts/review-default-payment-terms.mjs
 *   node scripts/review-default-payment-terms.mjs --json
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnvFile(resolve(ROOT, '.env'))
loadEnvFile(resolve(ROOT, '.env.local'))

const asJson = process.argv.includes('--json')
const connectionString =
  process.env.deed_erp_POSTGRES_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL

if (!connectionString) {
  console.error('ERROR: DATABASE_URL / POSTGRES_URL is not set')
  process.exit(1)
}

function isDefaultTerms(days) {
  return days === undefined || days === null || days === '' || Number(days) === 30
}

function summarize(rows) {
  const byType = {}
  for (const r of rows) {
    const t = r.type || r.client_type || 'unknown'
    byType[t] = (byType[t] || 0) + 1
  }
  return { count: rows.length, byType }
}

async function loadBlobContacts(pool) {
  const { rows } = await pool.query(
    `SELECT value FROM app_state WHERE key = $1`,
    ['deed_contacts'],
  )
  if (!rows.length) return []
  try {
    const parsed = JSON.parse(rows[0].value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function main() {
  const pool = new Pool({ connectionString })
  try {
    let prismaRows = []
    try {
      const { rows } = await pool.query(`
        SELECT
          id::text AS id,
          client_number,
          name,
          client_type,
          is_customer,
          is_vendor,
          payment_terms_days
        FROM clients
        WHERE payment_terms_days IS NULL OR payment_terms_days = 30
        ORDER BY name ASC
      `)
      prismaRows = rows.map(r => ({
        source: 'prisma.clients',
        id: r.id,
        clientNumber: r.client_number,
        name: r.name,
        type: r.client_type,
        isCustomer: r.is_customer,
        isVendor: r.is_vendor,
        paymentTermsDays: r.payment_terms_days,
        reason: r.payment_terms_days == null ? 'missing' : 'explicit_30',
      }))
    } catch (err) {
      if (asJson) {
        console.error(JSON.stringify({ error: `prisma clients query failed: ${err.message}` }))
      } else {
        console.error(`WARN: prisma clients query failed: ${err.message}`)
      }
    }

    const blobAll = await loadBlobContacts(pool)
    const blobRows = blobAll
      .filter(c => isDefaultTerms(c?.paymentTermsDays))
      .map(c => ({
        source: 'deed_contacts',
        id: c.id ?? null,
        name: c.name ?? null,
        type: c.type ?? null,
        isCustomer: c.isCustomer ?? null,
        isVendor: c.isVendor ?? null,
        paymentTermsDays:
          c.paymentTermsDays === undefined || c.paymentTermsDays === null || c.paymentTermsDays === ''
            ? null
            : Number(c.paymentTermsDays),
        reason:
          c.paymentTermsDays === undefined || c.paymentTermsDays === null || c.paymentTermsDays === ''
            ? 'missing'
            : 'explicit_30',
      }))

    const report = {
      dryRun: true,
      mutated: false,
      note: 'Contacts with paymentTermsDays === 30 or missing (default 30 days). No writes performed.',
      prisma: {
        ...summarize(prismaRows),
        items: prismaRows,
      },
      blob: {
        totalContacts: blobAll.length,
        ...summarize(blobRows),
        items: blobRows,
      },
    }

    if (asJson) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log('P1-DEED-005 review-default-payment-terms (dry-run, read-only)')
      console.log(`Prisma clients (default/missing 30): ${report.prisma.count}`)
      for (const [t, n] of Object.entries(report.prisma.byType)) {
        console.log(`  type=${t}: ${n}`)
      }
      console.log(`Blob deed_contacts total=${report.blob.totalContacts}; default/missing 30: ${report.blob.count}`)
      for (const [t, n] of Object.entries(report.blob.byType)) {
        console.log(`  type=${t}: ${n}`)
      }
      const preview = [...prismaRows.slice(0, 15), ...blobRows.slice(0, 15)]
      if (preview.length) {
        console.log('Sample:')
        for (const row of preview.slice(0, 20)) {
          console.log(
            `  - [${row.source}] ${row.name ?? '(unnamed)'} id=${row.id ?? '—'} days=${row.paymentTermsDays ?? 'null'} (${row.reason})`,
          )
        }
      } else {
        console.log('No contacts with default/missing payment terms found.')
      }
      console.log('No mutations performed.')
    }
  } finally {
    await pool.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
