#!/usr/bin/env node
/**
 * Ops helper: search repair jobs in deed_repairs_v2 (and related contacts).
 *
 *   node scripts/find-repairs.mjs --q turaco --q sample
 *   node scripts/find-repairs.mjs --request ops/find-repairs-request.json
 *   node scripts/find-repairs.mjs --since 2026-08-04 --q turaco
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnvFile(resolve(ROOT, '.env'))
loadEnvFile(resolve(ROOT, '.env.local'))

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}

function allArgs(flag) {
  const out = []
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag && process.argv[i + 1]) out.push(process.argv[i + 1])
  }
  return out
}

function fail(msg) {
  console.error(`ERROR: ${msg}`)
  process.exit(1)
}

const connectionString =
  process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) fail('DATABASE_URL / POSTGRES_URL is not set')

const requestPath = String(arg('--request', '')).trim()
let queries = allArgs('--q').map(s => String(s).trim()).filter(Boolean)
let since = String(arg('--since', '') || '').trim()
let limit = Number(arg('--limit', '50')) || 50

if (requestPath) {
  const abs = resolve(ROOT, requestPath)
  if (!existsSync(abs)) fail(`Request file not found: ${abs}`)
  const parsed = JSON.parse(readFileSync(abs, 'utf8'))
  const fromFile = Array.isArray(parsed?.queries) ? parsed.queries : []
  queries = [...queries, ...fromFile.map(s => String(s).trim()).filter(Boolean)]
  if (parsed?.since) since = String(parsed.since).trim()
  if (parsed?.limit) limit = Number(parsed.limit) || limit
}

if (!queries.length && !since) fail('Provide --q <text> and/or --since YYYY-MM-DD')

const needles = queries.map(q => q.toLowerCase())
const pool = new Pool({ connectionString })

function haystack(repair) {
  return [
    repair?.ref,
    repair?.customerName,
    repair?.customerPhone,
    repair?.contactPersonName,
    repair?.contactPersonPhone,
    repair?.productName,
    repair?.deviceBrand,
    repair?.deviceModel,
    repair?.serialNumber,
    repair?.issueDescription,
    repair?.notes,
    repair?.assignedTechnicianName,
  ]
    .map(v => String(v ?? '').toLowerCase())
    .join(' | ')
}

function summarize(repair) {
  return {
    ref: repair.ref,
    status: repair.status,
    customerName: repair.customerName,
    customerPhone: repair.customerPhone || repair.contactPersonPhone || '',
    productName: repair.productName,
    serialNumber: repair.serialNumber || '',
    intakeDate: repair.intakeDate,
    assignedTechnicianName: repair.assignedTechnicianName || null,
    total: repair.total ?? null,
  }
}

try {
  const { rows } = await pool.query(`SELECT value FROM app_state WHERE key = 'deed_repairs_v2'`)
  if (!rows.length) fail('No deed_repairs_v2 key found')
  const repairs = Array.isArray(rows[0].value) ? rows[0].value : JSON.parse(rows[0].value)
  if (!Array.isArray(repairs)) fail('deed_repairs_v2 is not an array')

  console.log(`Total repairs in blob: ${repairs.length}`)
  if (queries.length) console.log(`Queries: ${queries.join(', ')}`)
  if (since) console.log(`Since: ${since}`)

  // Date histogram + recent-by-created help catch missing intakes / bad intakeDate values.
  const byMonth = {}
  const byIntakeDay = {}
  const byCreatedDay = {}
  let badIntake = 0
  for (const r of repairs) {
    const intake = String(r?.intakeDate || '')
    const created = String(r?.createdDate || r?.createdAt || '')
    const month = intake.slice(0, 7) || '(blank)'
    byMonth[month] = (byMonth[month] || 0) + 1
    const day = intake.slice(0, 10) || '(blank)'
    byIntakeDay[day] = (byIntakeDay[day] || 0) + 1
    const cday = created.slice(0, 10) || '(blank)'
    byCreatedDay[cday] = (byCreatedDay[cday] || 0) + 1
    if (intake && (intake.startsWith('209') || intake.startsWith('19') || intake < '2020-01-01')) badIntake += 1
  }
  console.log('\n--- Intake month histogram ---')
  console.log(JSON.stringify(Object.fromEntries(Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0]))), null, 2))
  console.log(`Suspicious intakeDate values: ${badIntake}`)

  if (since) {
    const createdSince = repairs
      .filter(r => {
        const c = String(r?.createdDate || r?.createdAt || '')
        return c && c >= since
      })
      .sort((a, b) => String(b.createdDate || b.createdAt || '').localeCompare(String(a.createdDate || a.createdAt || '')))
      .slice(0, limit)
    console.log(`\n--- createdDate/createdAt >= ${since}: ${createdSince.length} (showing up to ${limit}) ---`)
    console.log(JSON.stringify(createdSince.map(r => ({
      ...summarize(r),
      createdDate: r.createdDate || null,
      createdAt: r.createdAt || null,
    })), null, 2))

    const recentIntakeDays = Object.entries(byIntakeDay)
      .filter(([d]) => d >= since || d.startsWith('209'))
      .sort((a, b) => b[0].localeCompare(a[0]))
    console.log(`\n--- intakeDate day counts (>= ${since} or year 209x) ---`)
    console.log(JSON.stringify(Object.fromEntries(recentIntakeDays), null, 2))

    const recentCreatedDays = Object.entries(byCreatedDay)
      .filter(([d]) => d >= since)
      .sort((a, b) => b[0].localeCompare(a[0]))
    console.log(`\n--- createdDate day counts (>= ${since}) ---`)
    console.log(JSON.stringify(Object.fromEntries(recentCreatedDays), null, 2))
  }

  let matched = repairs.filter(r => {
    if (since) {
      const d = String(r?.intakeDate || r?.createdAt || r?.createdDate || '')
      if (!d || d < since) return false
    }
    if (!needles.length) return true
    const text = haystack(r)
    return needles.some(n => text.includes(n))
  })

  matched = matched
    .sort((a, b) => String(b.intakeDate || '').localeCompare(String(a.intakeDate || '')))
    .slice(0, limit)

  console.log(`Matches: ${matched.length}`)
  console.log(JSON.stringify(matched.map(summarize), null, 2))

  // Also list today's intakes for context when searching a missing morning job
  if (since) {
    const today = repairs
      .filter(r => {
        const intake = String(r?.intakeDate || '')
        const created = String(r?.createdDate || r?.createdAt || '')
        return (intake && intake >= since) || (created && created >= since)
      })
      .sort((a, b) => String(b.intakeDate || b.createdDate || '').localeCompare(String(a.intakeDate || a.createdDate || '')))
      .slice(0, 30)
      .map(r => ({ ...summarize(r), createdDate: r.createdDate || null }))
    console.log(`\n--- Intakes/created since ${since} (up to 30) ---`)
    console.log(JSON.stringify(today, null, 2))
  }

  // Relational mirror (Prisma repairs table) — may retain rows wiped from the blob.
  try {
    const prismaCount = await pool.query(`SELECT COUNT(*)::int AS n FROM repairs`)
    console.log(`\n--- Prisma repairs table count: ${prismaCount.rows[0]?.n ?? 0} ---`)
    const prismaAll = await pool.query(
      `SELECT job_number, status, device_type, serial_number, intake_date, created_at
       FROM repairs
       ORDER BY COALESCE(intake_date, created_at) DESC`,
    )
    const blobRefs = new Set(repairs.map(r => String(r?.ref || '').trim()).filter(Boolean))
    const prismaOnly = prismaAll.rows.filter(row => !blobRefs.has(String(row.job_number || '').trim()))
    const blobOnly = repairs.filter(r => {
      const ref = String(r?.ref || '').trim()
      return ref && !prismaAll.rows.some(row => String(row.job_number || '').trim() === ref)
    })
    console.log(`Prisma-only (not in blob): ${prismaOnly.length}`)
    console.log(JSON.stringify(prismaOnly.slice(0, limit), null, 2))
    console.log(`Blob-only (not in Prisma): ${blobOnly.length}`)
    console.log(JSON.stringify(blobOnly.slice(0, 20).map(summarize), null, 2))
    if (since) {
      const prismaRecent = prismaAll.rows.filter(row => {
        const intake = row.intake_date ? new Date(row.intake_date).toISOString() : ''
        const created = row.created_at ? new Date(row.created_at).toISOString() : ''
        return (intake && intake >= since) || (created && created >= since)
      })
      console.log(`Prisma rows since ${since}: ${prismaRecent.length}`)
      console.log(JSON.stringify(prismaRecent.slice(0, limit), null, 2))
      const prismaOnlyRecent = prismaOnly.filter(row => {
        const intake = row.intake_date ? new Date(row.intake_date).toISOString() : ''
        const created = row.created_at ? new Date(row.created_at).toISOString() : ''
        return (intake && intake >= since) || (created && created >= since)
      })
      console.log(`Prisma-only since ${since}: ${prismaOnlyRecent.length}`)
      console.log(JSON.stringify(prismaOnlyRecent, null, 2))
    }
  } catch (err) {
    console.log(`\n--- Prisma repairs query skipped: ${err instanceof Error ? err.message : err} ---`)
  }

  // Contacts hit?
  if (needles.length) {
    const contactKeys = ['deed_contacts', 'deed_contactPersons']
    for (const key of contactKeys) {
      const res = await pool.query(`SELECT value FROM app_state WHERE key = $1`, [key])
      if (!res.rows.length) continue
      const arr = Array.isArray(res.rows[0].value) ? res.rows[0].value : JSON.parse(res.rows[0].value)
      if (!Array.isArray(arr)) continue
      const hits = arr.filter(c => {
        const text = [
          c?.name, c?.firstName, c?.lastName, c?.companyName,
          c?.phone, c?.mobile, c?.email, c?.tradingName,
        ].map(v => String(v ?? '').toLowerCase()).join(' | ')
        return needles.some(n => text.includes(n))
      }).slice(0, 20)
      console.log(`\n--- ${key} matches: ${hits.length} ---`)
      console.log(JSON.stringify(hits.map(c => ({
        id: c.id,
        name: c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim(),
        phone: c.phone || c.mobile || '',
        email: c.email || '',
        type: c.type || null,
      })), null, 2))
    }
  }
} finally {
  await pool.end()
}
