#!/usr/bin/env node
/**
 * Ops helper: enrich restored Prisma repair stubs with full JSON from Contabo backups.
 *
 * After the August blob wipe, stubs restored from Prisma lacked nested diagnosis,
 * quotes, notes, accessories, history, etc. This scans database.dump backups,
 * pulls the richest full repair row per ref, and merges into live deed_repairs_v2.
 * Also merges any missing deed_quotes rows linked to those repair ids.
 *
 *   node scripts/enrich-restored-repairs-from-backup.mjs --request ops/enrich-restored-repairs-request.json
 */
import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const BACKUP_ROOT = process.env.BACKUP_DIR || '/var/backups/deed-erp'

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
let backupRoot = BACKUP_ROOT
let maxBackups = Number(arg('--max-backups', '40')) || 40
let onlyStubs = true

if (requestPath) {
  const abs = resolve(ROOT, requestPath)
  if (!existsSync(abs)) fail(`Request file not found: ${abs}`)
  const parsed = JSON.parse(readFileSync(abs, 'utf8'))
  const fromRefs = Array.isArray(parsed?.refs) ? parsed.refs : []
  refs = [...refs, ...fromRefs.map(s => String(s).trim().toUpperCase()).filter(Boolean)]
  if (parsed?.since) since = String(parsed.since).trim()
  if (parsed?.apply === true) apply = true
  if (parsed?.backupRoot) backupRoot = String(parsed.backupRoot)
  if (parsed?.maxBackups) maxBackups = Number(parsed.maxBackups) || maxBackups
  if (parsed?.onlyStubs === false) onlyStubs = false
}

refs = [...new Set(refs)]
const pool = new Pool({ connectionString })

const RICH_KEYS = [
  'diagnosis', 'diagnosisHistory', 'quote', 'intakeNotes', 'notes', 'workNotes',
  'accessories', 'partsUsed', 'qcItems', 'statusHistory', 'communications',
  'issuePhotos', 'diagnosisReportUrl', 'diagnosisReportName', 'qcReportUrl',
  'repairPath', 'priority', 'assignedTechnicianName', 'technicianName',
]

function richnessScore(row) {
  if (!row || typeof row !== 'object') return 0
  let score = 0
  for (const key of RICH_KEYS) {
    const v = row[key]
    if (v == null || v === '') continue
    if (Array.isArray(v)) score += v.length > 0 ? 3 + Math.min(v.length, 5) : 0
    else if (typeof v === 'object') score += 5 + Object.keys(v).length
    else score += 2
  }
  if (row._restoredFromPrismaMirror) score -= 20
  return score
}

function summarizeRichness(row) {
  return {
    ref: row?.ref,
    status: row?.status,
    score: richnessScore(row),
    hasDiagnosis: Boolean(row?.diagnosis || (row?.diagnosisHistory || []).length),
    hasQuote: Boolean(row?.quote),
    hasNotes: Boolean(row?.notes || row?.intakeNotes || row?.workNotes),
    hasAccessories: Array.isArray(row?.accessories) && row.accessories.length > 0,
    hasHistory: Array.isArray(row?.statusHistory) && row.statusHistory.length > 0,
    stub: Boolean(row?._restoredFromPrismaMirror),
    assignedTechnicianName: row?.assignedTechnicianName || null,
  }
}

function listBackupDumps(root) {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
    .reverse()
    .map(name => ({ name, dump: join(root, name, 'database.dump') }))
    .filter(x => existsSync(x.dump))
    .slice(0, maxBackups)
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, ...opts })
}

async function extractStoreKeysViaTempDb(dumpPath, keys) {
  const dbName = `deed_enrich_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  const tmpDumpDir = mkdtempSync(join(tmpdir(), 'deed-enrich-dump-'))
  const tmpDump = join(tmpDumpDir, 'database.dump')

  const created = run('sudo', ['-n', '-u', 'postgres', 'createdb', dbName])
  if (created.status !== 0) {
    rmSync(tmpDumpDir, { recursive: true, force: true })
    throw new Error(`createdb failed: ${created.stderr || created.stdout || created.status}`)
  }

  const dropDb = () => {
    run('sudo', ['-n', '-u', 'postgres', 'dropdb', '--if-exists', dbName])
    rmSync(tmpDumpDir, { recursive: true, force: true })
  }

  try {
    // postgres OS user cannot read /var/backups/... (mode 600, deploy-user owned).
    // Copy to a world-readable temp path before sudo pg_restore.
    const copied = run('cp', ['--', dumpPath, tmpDump])
    if (copied.status !== 0) throw new Error(`cp dump failed: ${copied.stderr || copied.status}`)
    run('chmod', ['a+r', tmpDump])

    // Match live Contabo schema (TEXT value) so data-only restore succeeds.
    const ddl = run('sudo', ['-n', '-u', 'postgres', 'psql', '-d', dbName, '-v', 'ON_ERROR_STOP=1', '-c',
      `CREATE TABLE IF NOT EXISTS app_state (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL,
         updated_at TEXT NOT NULL DEFAULT NOW()::text
       );`,
    ])
    if (ddl.status !== 0) {
      throw new Error(`ddl failed: ${ddl.stderr || ddl.stdout}`)
    }

    const data = run('sudo', [
      '-n', '-u', 'postgres', 'pg_restore',
      '--no-owner', '--no-privileges', '--data-only',
      '-t', 'app_state',
      '-d', dbName,
      tmpDump,
    ])
    if (data.status !== 0) {
      console.warn(`  data-only restore note: ${(data.stderr || data.stdout || '').slice(0, 240)}`)
    }

    const out = {}
    for (const key of keys) {
      const q = run('sudo', [
        '-n', '-u', 'postgres', 'psql', '-d', dbName, '-At', '-c',
        `SELECT value::text FROM app_state WHERE key = '${key.replace(/'/g, "''")}'`,
      ])
      if (q.status === 0 && q.stdout?.trim()) {
        try {
          out[key] = JSON.parse(q.stdout.trim())
        } catch (err) {
          console.warn(`  parse failed for ${key}: ${err instanceof Error ? err.message : err}`)
        }
      }
    }

    if (!Object.keys(out).length) {
      // Fallback: restore schema+data for app_state from the readable copy.
      console.warn('  app_state empty after TEXT table restore — trying schema+data restore')
      run('sudo', ['-n', '-u', 'postgres', 'dropdb', '--if-exists', dbName])
      const recreated = run('sudo', ['-n', '-u', 'postgres', 'createdb', dbName])
      if (recreated.status !== 0) throw new Error('recreate failed')
      run('sudo', [
        '-n', '-u', 'postgres', 'pg_restore',
        '--no-owner', '--no-privileges',
        '-t', 'app_state',
        '-d', dbName,
        tmpDump,
      ])
      for (const key of keys) {
        const q = run('sudo', [
          '-n', '-u', 'postgres', 'psql', '-d', dbName, '-At', '-c',
          `SELECT value::text FROM app_state WHERE key = '${key.replace(/'/g, "''")}'`,
        ])
        if (q.status === 0 && q.stdout?.trim()) {
          try { out[key] = JSON.parse(q.stdout.trim()) } catch { /* ignore */ }
        }
      }
    }

    if (!Object.keys(out).length) {
      // Last resort: full database restore from the readable copy.
      console.warn('  still empty — full pg_restore from temp copy')
      run('sudo', ['-n', '-u', 'postgres', 'dropdb', '--if-exists', dbName])
      const recreated = run('sudo', ['-n', '-u', 'postgres', 'createdb', dbName])
      if (recreated.status !== 0) throw new Error('recreate failed')
      const full = run('sudo', [
        '-n', '-u', 'postgres', 'pg_restore',
        '--no-owner', '--no-privileges',
        '-d', dbName,
        tmpDump,
      ])
      if (full.status !== 0) {
        console.warn(`  full restore warnings: ${(full.stderr || '').slice(0, 300)}`)
      }
      for (const key of keys) {
        const q = run('sudo', [
          '-n', '-u', 'postgres', 'psql', '-d', dbName, '-At', '-c',
          `SELECT value::text FROM app_state WHERE key = '${key.replace(/'/g, "''")}'`,
        ])
        if (q.status === 0 && q.stdout?.trim()) {
          try { out[key] = JSON.parse(q.stdout.trim()) } catch { /* ignore */ }
        }
      }
    }

    return out
  } finally {
    dropDb()
  }
}

function preferRicher(current, candidate, source) {
  if (!candidate) return { row: current, source }
  if (!current) return { row: { ...candidate, _enrichedFromBackup: source, _enrichedAt: new Date().toISOString() }, source }
  const curScore = richnessScore(current)
  const candScore = richnessScore(candidate)
  if (candScore > curScore) {
    // Keep live id if present; otherwise take candidate wholesale.
    const merged = {
      ...candidate,
      id: current.id || candidate.id,
      _restoredFromPrismaMirror: undefined,
      _enrichedFromBackup: source,
      _enrichedAt: new Date().toISOString(),
      // Preserve heal markers if candidate lacks names
      assignedTechnicianId: candidate.assignedTechnicianId || current.assignedTechnicianId,
      assignedTechnicianName: candidate.assignedTechnicianName || current.assignedTechnicianName,
      technicianName: candidate.technicianName || current.technicianName,
    }
    delete merged._restoredFromPrismaMirror
    return { row: merged, source }
  }
  return { row: current, source: current._enrichedFromBackup || null }
}

try {
  const liveState = await pool.query(
    `SELECT key, value FROM app_state WHERE key = ANY($1::text[])`,
    [['deed_repairs_v2', 'deed_quotes']],
  )
  const byKey = Object.fromEntries(
    liveState.rows.map(r => [r.key, Array.isArray(r.value) ? r.value : (() => { try { return JSON.parse(r.value) } catch { return r.value } })()]),
  )
  let liveRepairs = Array.isArray(byKey.deed_repairs_v2) ? byKey.deed_repairs_v2 : []
  let liveQuotes = Array.isArray(byKey.deed_quotes) ? byKey.deed_quotes : []
  if (!liveRepairs.length) fail('deed_repairs_v2 missing or empty')

  console.log(`Live repairs: ${liveRepairs.length}`)
  console.log(`Live quotes: ${liveQuotes.length}`)

  let targets = liveRepairs.filter(r => {
    const ref = String(r?.ref || '').trim().toUpperCase()
    if (!ref) return false
    if (refs.length && !refs.includes(ref)) return false
    if (onlyStubs && !r._restoredFromPrismaMirror && richnessScore(r) >= 8) return false
    if (since) {
      const d = String(r.intakeDate || r.createdDate || '')
      if (d && d < since && !r._restoredFromPrismaMirror) return false
    }
    return onlyStubs ? Boolean(r._restoredFromPrismaMirror) : true
  })

  if (!targets.length && refs.length) {
    targets = liveRepairs.filter(r => refs.includes(String(r?.ref || '').trim().toUpperCase()))
  }
  if (!targets.length && since) {
    targets = liveRepairs.filter(r => String(r?.intakeDate || r?.createdDate || '') >= since)
  }

  const targetRefs = new Set(targets.map(r => String(r.ref).trim().toUpperCase()))
  console.log(`Targets to enrich: ${targetRefs.size}`)
  console.log(JSON.stringify([...targetRefs], null, 2))
  console.log('Current richness:')
  console.log(JSON.stringify(targets.map(summarizeRichness), null, 2))
  if (!targetRefs.size) {
    console.log('Nothing to enrich.')
    process.exit(0)
  }

  const bestByRef = new Map()
  for (const row of targets) {
    bestByRef.set(String(row.ref).trim().toUpperCase(), { row, source: 'live' })
  }

  const quoteById = new Map(liveQuotes.map(q => [String(q?.id || ''), q]))
  const recoveredQuotes = []

  const dumps = listBackupDumps(backupRoot)
  console.log(`Scanning up to ${dumps.length} backups under ${backupRoot}`)

  for (const { name, dump } of dumps) {
    const stillPoor = [...bestByRef.entries()].filter(([, v]) => richnessScore(v.row) < 8)
    if (!stillPoor.length) {
      console.log('All targets already rich — stopping backup scan.')
      break
    }
    console.log(`\nScanning ${name} (still needing enrichment: ${stillPoor.length})...`)
    let extracted
    try {
      extracted = await extractStoreKeysViaTempDb(dump, ['deed_repairs_v2', 'deed_quotes'])
    } catch (err) {
      console.warn(`  skip: ${err instanceof Error ? err.message : err}`)
      continue
    }
    const repairs = Array.isArray(extracted.deed_repairs_v2) ? extracted.deed_repairs_v2 : []
    const quotes = Array.isArray(extracted.deed_quotes) ? extracted.deed_quotes : []
    console.log(`  dump repairs=${repairs.length} quotes=${quotes.length}`)
    if (!repairs.length) continue

    for (const cand of repairs) {
      const ref = String(cand?.ref || '').trim().toUpperCase()
      if (!targetRefs.has(ref)) continue
      const prev = bestByRef.get(ref)
      const next = preferRicher(prev?.row, cand, name)
      if (next.source === name) {
        console.log(`  upgraded ${ref} score ${richnessScore(prev?.row)} -> ${richnessScore(next.row)} from ${name}`)
        bestByRef.set(ref, next)
      }
    }

    // Collect quotes linked to target repair ids
    const targetIds = new Set(
      [...bestByRef.values()].map(v => String(v.row?.id || '')).filter(Boolean),
    )
    for (const q of quotes) {
      const repairId = String(q?.repairId || '')
      if (!repairId || !targetIds.has(repairId)) continue
      const id = String(q?.id || '')
      if (!id || quoteById.has(id)) continue
      quoteById.set(id, { ...q, _enrichedFromBackup: name })
      recoveredQuotes.push({ id, ref: q.ref || null, repairId, source: name })
      console.log(`  recovered quote ${q.ref || id} for repair ${repairId}`)
    }
  }

  const upgrades = []
  const nextRepairs = liveRepairs.map(row => {
    const ref = String(row?.ref || '').trim().toUpperCase()
    if (!targetRefs.has(ref)) return row
    const best = bestByRef.get(ref)
    if (!best || best.source === 'live') return row
    upgrades.push({
      ref,
      from: summarizeRichness(row),
      to: summarizeRichness(best.row),
      source: best.source,
    })
    return best.row
  })

  console.log(`\nRepair upgrades: ${upgrades.length}`)
  console.log(JSON.stringify(upgrades, null, 2))
  console.log(`Quote recoveries: ${recoveredQuotes.length}`)
  console.log(JSON.stringify(recoveredQuotes, null, 2))

  const stillPoor = [...bestByRef.entries()]
    .filter(([, v]) => richnessScore(v.row) < 8)
    .map(([ref, v]) => ({ ref, ...summarizeRichness(v.row) }))
  if (stillPoor.length) {
    console.log('\nStill thin after backup scan (Prisma stub may be all that survived):')
    console.log(JSON.stringify(stillPoor, null, 2))
  }

  if (!upgrades.length && !recoveredQuotes.length) {
    console.log('No richer backup rows found — aborting without write.')
    process.exit(1)
  }

  if (!apply) {
    console.log('\nDry-run only. Re-run with apply=true to write.')
    process.exit(0)
  }

  const nextQuotes = [...quoteById.values()]
  await pool.query('BEGIN')
  try {
    await pool.query(
      `UPDATE app_state SET value = $1::jsonb, updated_at = NOW() WHERE key = 'deed_repairs_v2'`,
      [JSON.stringify(nextRepairs)],
    )
    if (recoveredQuotes.length) {
      await pool.query(
        `UPDATE app_state SET value = $1::jsonb, updated_at = NOW() WHERE key = 'deed_quotes'`,
        [JSON.stringify(nextQuotes)],
      )
    }
    await pool.query('COMMIT')
  } catch (err) {
    await pool.query('ROLLBACK')
    throw err
  }
  console.log(`\nApplied. Upgraded ${upgrades.length} repairs; added ${recoveredQuotes.length} quotes.`)
  console.log('Hard-refresh clients to pick up SSE/store updates.')
} finally {
  await pool.end()
}
