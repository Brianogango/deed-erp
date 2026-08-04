#!/usr/bin/env node
/**
 * Ops helper: re-apply technician assignment onto restored repair stubs.
 *
 * Prisma mirror stubs were restored without assignedTechnicianName (UI shows
 * Unassigned when the name is blank). This patches deed_repairs_v2 from
 * repairs.assigned_to + users.name.
 *
 *   node scripts/heal-restored-repair-assignments.mjs --request ops/heal-restored-repair-assignments-request.json
 *   node scripts/heal-restored-repair-assignments.mjs --since 2026-08-01 --apply
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

function loadEnv(filePath) {
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

loadEnv(resolve(ROOT, '.env'))
loadEnv(resolve(ROOT, '.env.local'))

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
let refs = allArgs('--ref').map(s => String(s).trim().toUpperCase()).filter(Boolean)
let since = String(arg('--since', '') || '').trim()
let apply = process.argv.includes('--apply')

if (requestPath) {
  const abs = resolve(ROOT, requestPath)
  if (!existsSync(abs)) fail(`Request file not found: ${abs}`)
  const parsed = JSON.parse(readFileSync(abs, 'utf8'))
  const fromRefs = Array.isArray(parsed?.refs) ? parsed.refs : []
  refs = [...refs, ...fromRefs.map(s => String(s).trim().toUpperCase()).filter(Boolean)]
  if (parsed?.since) since = String(parsed.since).trim()
  if (parsed?.apply === true) apply = true
}

refs = [...new Set(refs)]
const pool = new Pool({ connectionString })

try {
  const { rows } = await pool.query(`SELECT value FROM app_state WHERE key = 'deed_repairs_v2'`)
  if (!rows.length) fail('No deed_repairs_v2 key found')
  const live = Array.isArray(rows[0].value) ? rows[0].value : JSON.parse(rows[0].value)
  if (!Array.isArray(live)) fail('deed_repairs_v2 is not an array')

  const prisma = await pool.query(
    `SELECT r.job_number, r.assigned_to, r.status AS prisma_status, r.intake_date, r.created_at,
            u.id AS tech_id, u.name AS tech_name
     FROM repairs r
     LEFT JOIN users u ON u.id = r.assigned_to
     WHERE r.assigned_to IS NOT NULL`,
  )
  const byRef = new Map(
    prisma.rows.map(r => [String(r.job_number || '').trim().toUpperCase(), r]),
  )

  const changes = []
  const next = live.map(row => {
    const ref = String(row?.ref || '').trim().toUpperCase()
    if (!ref) return row
    if (refs.length && !refs.includes(ref)) return row

    const mirror = byRef.get(ref)
    if (!mirror?.assigned_to || !mirror.tech_name) return row

    if (since) {
      const intake = mirror.intake_date ? new Date(mirror.intake_date).toISOString() : ''
      const created = mirror.created_at ? new Date(mirror.created_at).toISOString() : ''
      const blobCreated = String(row.createdDate || row.intakeDate || '')
      if (!(intake >= since || created >= since || blobCreated >= since)) return row
    }

    const needsId = row.assignedTechnicianId !== mirror.assigned_to
    const needsName = !row.assignedTechnicianName || row.assignedTechnicianName !== mirror.tech_name
    const shouldPromoteStatus = ['received', 'pending_verification'].includes(String(row.status || ''))
    if (!needsId && !needsName && !shouldPromoteStatus) return row

    const patched = {
      ...row,
      assignedTechnicianId: mirror.assigned_to,
      assignedTechnicianName: mirror.tech_name,
      technicianName: mirror.tech_name,
      assignedDate: row.assignedDate || String(row.createdDate || new Date().toISOString().slice(0, 10)),
      status: shouldPromoteStatus ? 'assigned' : row.status,
      _assignmentHealedAt: new Date().toISOString(),
    }
    changes.push({
      ref,
      before: {
        assignedTechnicianId: row.assignedTechnicianId || null,
        assignedTechnicianName: row.assignedTechnicianName || null,
        status: row.status,
      },
      after: {
        assignedTechnicianId: patched.assignedTechnicianId,
        assignedTechnicianName: patched.assignedTechnicianName,
        status: patched.status,
      },
    })
    return patched
  })

  console.log(`Live repairs: ${live.length}`)
  console.log(`Prisma assigned repairs: ${prisma.rows.length}`)
  console.log(`Patches: ${changes.length}`)
  console.log(JSON.stringify(changes, null, 2))

  if (!changes.length) {
    console.log('Nothing to heal.')
    process.exit(0)
  }
  if (!apply) {
    console.log('\nDry-run only. Re-run with apply=true to write.')
    process.exit(0)
  }

  await pool.query(
    `UPDATE app_state SET value = $1::jsonb, updated_at = NOW() WHERE key = 'deed_repairs_v2'`,
    [JSON.stringify(next)],
  )
  console.log(`\nApplied ${changes.length} assignment heal(s).`)
} finally {
  await pool.end()
}
