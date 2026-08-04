#!/usr/bin/env node
/**
 * Ops helper: restore missing repair jobs into deed_repairs_v2 from Contabo backups.
 *
 * Finds refs present in Prisma (or requested) but absent from the live blob, then
 * scans backup database.dump files under /var/backups/deed-erp for those full JSON
 * rows and merges them back. Samples can be excluded.
 *
 *   node scripts/restore-missing-repairs.mjs --request ops/restore-missing-repairs-request.json
 *   node scripts/restore-missing-repairs.mjs --since 2026-08-01 --apply
 *   node scripts/restore-missing-repairs.mjs --ref REP-473163 --dry-run
 *
 * Default is dry-run. Pass --apply (or request.apply=true) to write.
 */
import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const BACKUP_ROOT = process.env.BACKUP_DIR || '/var/backups/deed-erp'

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
let refs = allArgs('--ref').map(s => String(s).trim().toUpperCase()).filter(Boolean)
let since = String(arg('--since', '') || '').trim()
let excludeSamples = true
let apply = process.argv.includes('--apply')
let backupRoot = BACKUP_ROOT
let skipBackups = process.argv.includes('--skip-backups')

if (requestPath) {
  const abs = resolve(ROOT, requestPath)
  if (!existsSync(abs)) fail(`Request file not found: ${abs}`)
  const parsed = JSON.parse(readFileSync(abs, 'utf8'))
  const fromRefs = Array.isArray(parsed?.refs) ? parsed.refs : []
  refs = [...refs, ...fromRefs.map(s => String(s).trim().toUpperCase()).filter(Boolean)]
  if (parsed?.since) since = String(parsed.since).trim()
  if (parsed?.apply === true) apply = true
  if (parsed?.excludeSamples === false) excludeSamples = false
  if (parsed?.backupRoot) backupRoot = String(parsed.backupRoot)
  if (parsed?.skipBackups === true) skipBackups = true
}

refs = [...new Set(refs)]
const pool = new Pool({ connectionString })

function isSampleRepair(row) {
  const hay = [
    row?.customerName, row?.productName, row?.device_type, row?.issueDescription, row?.ref, row?.job_number,
  ].map(v => String(v ?? '').toLowerCase()).join(' ')
  return /\bsample\b/.test(hay)
}

function summarize(r) {
  return {
    ref: r.ref || r.job_number,
    status: r.status,
    customerName: r.customerName || null,
    productName: r.productName || r.device_type || null,
    intakeDate: r.intakeDate || r.intake_date || null,
    createdDate: r.createdDate || r.created_at || null,
  }
}

function listBackupDumps(root) {
  if (!existsSync(root)) return []
  const entries = readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
    .reverse()
  const dumps = []
  for (const name of entries) {
    const dump = join(root, name, 'database.dump')
    if (existsSync(dump)) dumps.push({ name, dump })
  }
  return dumps
}

function extractRepairsFromDump(dumpPath) {
  const dir = mkdtempSync(join(tmpdir(), 'deed-restore-repairs-'))
  const sqlPath = join(dir, 'app_state.sql')
  try {
    const restored = spawnSync(
      'pg_restore',
      ['--data-only', '--no-owner', '--no-privileges', '-t', 'app_state', '-f', sqlPath, dumpPath],
      { encoding: 'utf8' },
    )
    if (restored.status !== 0) {
      // Some dumps may need table-only extract differently; try COPY via temp DB-less parse failure.
      console.warn(`pg_restore warning for ${dumpPath}: ${restored.stderr || restored.stdout || restored.status}`)
    }
    if (!existsSync(sqlPath)) return null
    const sql = readFileSync(sqlPath, 'utf8')
    // COPY public.app_state (key, value, ...) FROM stdin;
    // Look for the deed_repairs_v2 row in COPY or INSERT form.
    const copyMatch = sql.match(/COPY\s+(?:public\.)?app_state\b[^]*?FROM stdin;\n([\s\S]*?)\n\\\./i)
    if (copyMatch) {
      for (const line of copyMatch[1].split('\n')) {
        if (!line.includes('deed_repairs_v2')) continue
        // tab-separated: key \t value(json) \t ...
        const parts = line.split('\t')
        const keyIdx = parts.findIndex(p => p === 'deed_repairs_v2')
        if (keyIdx < 0) continue
        // value is usually next column; may be jsonb as string
        const raw = parts[keyIdx + 1]
        if (!raw) continue
        const unescaped = raw
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\r/g, '\r')
          .replace(/\\\\/g, '\\')
        try {
          const parsed = JSON.parse(unescaped)
          return Array.isArray(parsed) ? parsed : null
        } catch {
          // jsonb sometimes already starts with [
        }
      }
    }
    // INSERT INTO app_state ... VALUES ('deed_repairs_v2', '...')
    const insertRe = /INSERT INTO\s+(?:public\.)?app_state[^;]*?deed_repairs_v2[^;]*;/gi
    // Fallback: write a small node helper using psql + temp db when COPY parse fails
    return null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function extractRepairsViaTempDb(dumpPath) {
  const dbName = `deed_restore_${Date.now().toString(36)}`
  // Prefer OS postgres role (Contabo) — app DB users often lack CREATEDB.
  const created = spawnSync('sudo', ['-n', '-u', 'postgres', 'createdb', dbName], { encoding: 'utf8' })
  if (created.status !== 0) {
    const adminUrl = connectionString.replace(/\/[^/?]+(\?|$)/, '/postgres$1')
    const admin = new Pool({ connectionString: adminUrl })
    try {
      await admin.query(`CREATE DATABASE ${dbName}`)
    } finally {
      await admin.end()
    }
  }

  const dropDb = async () => {
    const dropped = spawnSync('sudo', ['-n', '-u', 'postgres', 'dropdb', '--if-exists', dbName], { encoding: 'utf8' })
    if (dropped.status === 0) return
    const adminUrl = connectionString.replace(/\/[^/?]+(\?|$)/, '/postgres$1')
    const admin = new Pool({ connectionString: adminUrl })
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName}`)
    } finally {
      await admin.end()
    }
  }

  try {
    // Restore schema + data for app_state only.
    spawnSync('sudo', ['-n', '-u', 'postgres', 'pg_restore', '--no-owner', '--no-privileges', '-s', '-t', 'app_state', '-d', dbName, dumpPath], { encoding: 'utf8' })
    spawnSync('sudo', ['-n', '-u', 'postgres', 'pg_restore', '--no-owner', '--no-privileges', '--data-only', '-t', 'app_state', '-d', dbName, dumpPath], { encoding: 'utf8' })

    const q = spawnSync(
      'sudo',
      ['-n', '-u', 'postgres', 'psql', '-d', dbName, '-At', '-c', "SELECT value::text FROM app_state WHERE key = 'deed_repairs_v2'"],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
    if (q.status !== 0 || !q.stdout?.trim()) {
      // Fallback: connect with app URL rewritten to temp db (if peer auth not required)
      const dbUrl = connectionString.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`)
      const tmp = new Pool({ connectionString: dbUrl })
      try {
        const { rows } = await tmp.query(`SELECT value FROM app_state WHERE key = 'deed_repairs_v2'`)
        if (!rows.length) return null
        const value = rows[0].value
        return Array.isArray(value) ? value : JSON.parse(value)
      } finally {
        await tmp.end()
      }
    }
    const raw = q.stdout.trim()
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } finally {
    await dropDb()
  }
}

const PRISMA_STATUS_TO_BLOB = {
  intake: 'received',
  diagnosis: 'diagnosed',
  awaiting_parts: 'awaiting_parts',
  in_repair: 'in_repair',
  qc: 'qc',
  ready: 'ready',
  verified_released: 'verified_released',
  collected: 'delivered',
  cancelled: 'cancelled',
  unrepairable: 'unrepairable',
}

async function buildStubFromPrisma(poolConn, missingRefs) {
  if (!missingRefs.length) return []
  const { rows } = await poolConn.query(
    `SELECT r.id, r.job_number, r.status, r.device_type, r.device_brand, r.device_model,
            r.serial_number, r.reported_fault, r.observed_fault, r.condition_on_intake,
            r.accessories_in, r.estimated_cost, r.labour_cost, r.parts_cost,
            r.intake_date, r.completed_date, r.collected_date, r.priority, r.source,
            r.notes, r.resolution_notes, r.created_at, r.client_id, r.assigned_to,
            c.name AS client_name, c.phone AS client_phone, c.email AS client_email,
            u.name AS tech_name
     FROM repairs r
     LEFT JOIN clients c ON c.id = r.client_id
     LEFT JOIN users u ON u.id = r.assigned_to
     WHERE r.job_number = ANY($1::text[])`,
    [missingRefs],
  )
  return rows.map(r => {
    const intakeIso = r.intake_date ? new Date(r.intake_date).toISOString() : new Date().toISOString()
    const createdDay = r.created_at
      ? new Date(r.created_at).toISOString().slice(0, 10)
      : intakeIso.slice(0, 10)
    let status = PRISMA_STATUS_TO_BLOB[r.status] || 'received'
    // Blob uses "assigned" once a technician is set; Prisma keeps intake/diagnosis/etc.
    if (r.assigned_to && status === 'received') status = 'assigned'
    return {
      id: r.id,
      ref: r.job_number,
      status,
      customerId: r.client_id || '',
      customerName: r.client_name || 'Unknown customer',
      customerPhone: r.client_phone || '',
      customerEmail: r.client_email || undefined,
      productId: '',
      productName: r.device_type || 'Device',
      serialNumber: r.serial_number || '',
      deviceCondition: r.condition_on_intake || 'good',
      deviceBrand: r.device_brand || undefined,
      deviceModel: r.device_model || undefined,
      intakeChannel: r.source || 'walk_in',
      intakeDate: intakeIso,
      intakeNotes: r.notes || '',
      issueDescription: r.reported_fault || '',
      accessories: Array.isArray(r.accessories_in)
        ? r.accessories_in.map(name => ({ id: cryptoRandom(), name: String(name) }))
        : [],
      underWarranty: false,
      warrantyVerificationStatus: 'not_checked',
      assignedTechnicianId: r.assigned_to || undefined,
      assignedTechnicianName: r.tech_name || undefined,
      technicianName: r.tech_name || undefined,
      assignedDate: r.assigned_to ? createdDay : undefined,
      partsUsed: [],
      laborCost: Number(r.labour_cost || 0),
      logisticsCost: 0,
      total: Number(r.estimated_cost || 0) || (Number(r.labour_cost || 0) + Number(r.parts_cost || 0)),
      qcItems: [],
      priority: r.priority || 'normal',
      createdBy: 'system',
      bookedByName: 'Restored from mirror',
      createdDate: createdDay,
      notes: r.resolution_notes || '',
      slaMissed: false,
      diagnosis: r.observed_fault
        ? { faultDescription: r.observed_fault, date: createdDay }
        : undefined,
      _restoredFromPrismaMirror: true,
      _restoredAt: new Date().toISOString(),
    }
  })
}

function cryptoRandom() {
  return `restored-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

try {
  const { rows } = await pool.query(`SELECT value FROM app_state WHERE key = 'deed_repairs_v2'`)
  if (!rows.length) fail('No deed_repairs_v2 key found')
  let live = Array.isArray(rows[0].value) ? rows[0].value : JSON.parse(rows[0].value)
  if (!Array.isArray(live)) fail('deed_repairs_v2 is not an array')
  const liveRefs = new Set(live.map(r => String(r?.ref || '').trim().toUpperCase()).filter(Boolean))
  console.log(`Live blob repairs: ${live.length}`)

  // Targets: explicit refs, else Prisma-only since date
  let targets = [...refs]
  if (!targets.length) {
    const prisma = await pool.query(
      `SELECT job_number, status, device_type, intake_date, created_at
       FROM repairs
       ORDER BY COALESCE(intake_date, created_at) DESC`,
    )
    targets = prisma.rows
      .map(r => String(r.job_number || '').trim().toUpperCase())
      .filter(ref => ref && !liveRefs.has(ref))
    if (since) {
      const prismaSince = new Set(
        prisma.rows
          .filter(r => {
            const intake = r.intake_date ? new Date(r.intake_date).toISOString() : ''
            const created = r.created_at ? new Date(r.created_at).toISOString() : ''
            return (intake && intake >= since) || (created && created >= since)
          })
          .map(r => String(r.job_number || '').trim().toUpperCase()),
      )
      targets = targets.filter(ref => prismaSince.has(ref))
    }
  }

  if (excludeSamples) {
    const prismaMeta = await pool.query(`SELECT job_number, device_type FROM repairs`)
    const sampleRefs = new Set(
      prismaMeta.rows
        .filter(r => isSampleRepair(r))
        .map(r => String(r.job_number || '').trim().toUpperCase()),
    )
    targets = targets.filter(ref => !sampleRefs.has(ref) && !/^REP-861745$/.test(ref))
  }

  targets = [...new Set(targets)].filter(ref => !liveRefs.has(ref))
  console.log(`Missing targets to restore: ${targets.length}`)
  console.log(JSON.stringify(targets, null, 2))
  if (!targets.length) {
    console.log('Nothing to restore.')
    process.exit(0)
  }

  const remaining = new Set(targets)
  const recovered = new Map()
  const dumps = skipBackups ? [] : listBackupDumps(backupRoot)
  console.log(`Backup dumps found: ${dumps.length} under ${backupRoot}${skipBackups ? ' (skipped)' : ''}`)

  for (const { name, dump } of dumps) {
    if (remaining.size === 0) break
    console.log(`\nScanning backup ${name}...`)
    let repairs = null
    try {
      repairs = await extractRepairsViaTempDb(dump)
    } catch (err) {
      console.warn(`  skip (${err instanceof Error ? err.message : err})`)
      try { repairs = extractRepairsFromDump(dump) } catch { repairs = null }
    }
    if (!Array.isArray(repairs)) {
      console.warn('  no repairs blob in dump')
      continue
    }
    console.log(`  dump has ${repairs.length} repairs`)
    for (const row of repairs) {
      const ref = String(row?.ref || '').trim().toUpperCase()
      if (!remaining.has(ref)) continue
      recovered.set(ref, row)
      remaining.delete(ref)
      console.log(`  recovered ${ref} (full JSON from backup)`)
    }
  }

  if (remaining.size > 0) {
    console.log(`\nBuilding Prisma mirror stubs for ${remaining.size} still-missing refs...`)
    const stubs = await buildStubFromPrisma(pool, [...remaining])
    for (const stub of stubs) {
      const ref = String(stub.ref || '').trim().toUpperCase()
      if (!remaining.has(ref)) continue
      recovered.set(ref, stub)
      remaining.delete(ref)
      console.log(`  stubbed ${ref} from Prisma mirror`)
    }
  }

  console.log(`\nRecovered: ${recovered.size}`)
  console.log(`Still missing: ${remaining.size}`)
  if (remaining.size) console.log(JSON.stringify([...remaining], null, 2))
  console.log(JSON.stringify([...recovered.values()].map(summarize), null, 2))

  if (!recovered.size) {
    console.log('Nothing recovered — aborting without write.')
    process.exit(1)
  }

  if (!apply) {
    console.log('\nDry-run only. Re-run with apply=true to merge into live deed_repairs_v2.')
    process.exit(0)
  }

  const merged = [
    ...[...recovered.values()],
    ...live,
  ]
  const byRef = new Map()
  for (const row of merged) {
    const ref = String(row?.ref || '').trim().toUpperCase()
    if (!ref) continue
    if (!byRef.has(ref)) byRef.set(ref, row)
  }
  const next = [...byRef.values()].sort((a, b) =>
    String(b.intakeDate || b.createdDate || '').localeCompare(String(a.intakeDate || a.createdDate || '')),
  )

  await pool.query(
    `UPDATE app_state SET value = $1::jsonb, updated_at = NOW() WHERE key = 'deed_repairs_v2'`,
    [JSON.stringify(next)],
  )
  console.log(`\nApplied. Live blob now ${next.length} repairs (+${recovered.size}).`)
  console.log('Clients will pick this up via SSE / refresh.')
} finally {
  await pool.end()
}
