#!/usr/bin/env node
/**
 * The log for one repair job: who did what, when, from which address and on
 * what device.
 *
 *   node scripts/repair-log.mjs REP-P3D65KY2
 *   node scripts/repair-log.mjs REP-P3D65KY2 --json
 *   node scripts/repair-log.mjs REP-P3D65KY2 --sessions   (add the sign-ins
 *                                                          that cover the job)
 *
 * Read-only: it runs SELECTs and nothing else.
 *
 * What a log can and cannot say about "which machine":
 *   - The address is the one nginx saw. Behind a shared office line every
 *     person in the shop has the same one.
 *   - A browser never reports a computer's make or model, so a laptop reads
 *     as "Windows PC · Chrome 141". Phones do send a model, and it is shown.
 *   - Entries written before the browser was recorded show "—"; the --sessions
 *     view falls back to that person's sign-ins at the time, which carry the
 *     address and browser.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { deviceLabel } from './lib/user-agent.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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

const args = process.argv.slice(2)
const flags = new Set(args.filter(a => a.startsWith('--')))
const target = args.find(a => !a.startsWith('--'))
const asJson = flags.has('--json')
const withSessions = flags.has('--sessions')

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

if (!target) fail('Give the repair reference, e.g. node scripts/repair-log.mjs REP-P3D65KY2')

const connectionString =
  process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) fail('DATABASE_URL / POSTGRES_URL is not set')

const pool = new Pool({ connectionString, ssl: false })
const q = (text, values = []) => pool.query(text, values).then(r => r.rows)

// Times print in the shop's own clock, not UTC, so they match what people
// remember doing. Override with TZ=... when reading from elsewhere.
const ZONE = process.env.TZ || 'Africa/Nairobi'
const when = value => {
  const date = value instanceof Date ? value : new Date(String(value))
  if (!Number.isFinite(date.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {})
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
}
const pad = (value, width) => String(value ?? '').padEnd(width).slice(0, width)
/** 'verify_repair_intake' → 'Verify repair intake'. */
const readable = action => {
  const words = String(action || '').replace(/[._-]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Action'
}

async function main() {
  const job = await findRepair(target)
  if (!job) fail(`No repair found for "${target}"`)

  // Entries were written against the reference on some actions and the id on
  // others, so both are matched.
  const keys = [job.id, job.ref].filter(Boolean)
  const entries = await q(
    `SELECT a.created_at,
            a.action,
            a.ip_address,
            ${await hasUserAgent() ? 'a.user_agent' : 'NULL::text AS user_agent'},
            COALESCE(a.new_values ->> 'details', '')  AS details,
            COALESCE(u.name, a.new_values ->> 'username', 'system') AS actor,
            COALESCE(u.role, '') AS role
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity_key = ANY($1::text[])
      ORDER BY a.created_at ASC`,
    [keys],
  )

  const rows = entries.map(e => ({
    at: when(e.created_at),
    actor: e.actor,
    role: e.role,
    action: readable(e.action),
    details: e.details,
    ip: e.ip_address || null,
    device: e.user_agent ? deviceLabel(e.user_agent) : null,
  }))

  // Sign-ins of the people on this job, which carry the address and browser
  // even for actions recorded before those were kept on the entry itself.
  let sessions = []
  if (withSessions && entries.length) {
    const names = [...new Set(entries.map(e => e.actor).filter(Boolean))]
    const first = entries[0].created_at
    const last = entries[entries.length - 1].created_at
    sessions = await q(
      `SELECT u.name AS actor, s.ip_address, s.user_agent, s.created_at, s.expires_at
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE (u.name = ANY($1::text[]) OR u.username = ANY($1::text[]))
          -- a session that was open at any point while this job was worked on
          AND s.created_at <= $3::timestamptz + interval '1 day'
          AND s.expires_at  >= $2::timestamptz - interval '1 day'
        ORDER BY s.created_at DESC
        LIMIT 100`,
      [names, first, last],
    ).then(list => list.map(s => ({
      actor: s.actor,
      from: when(s.created_at),
      until: when(s.expires_at),
      ip: s.ip_address || null,
      device: s.user_agent ? deviceLabel(s.user_agent) : null,
    })))
  }

  if (asJson) {
    console.log(JSON.stringify({ job, entries: rows, sessions }, null, 2))
    return
  }

  console.log('')
  console.log(`REPAIR ${job.ref}  ·  ${job.device || 'device not named'}  ·  ${job.customer || 'no customer'}`)
  console.log(`status ${job.status || '—'}   booked ${job.intake_date || '—'}   technician ${job.technician || 'unassigned'}`)
  console.log('')

  if (!rows.length) {
    console.log('No recorded actions on this job.')
    console.log('')
    return
  }

  const w = {
    at: 16,
    actor: Math.max(12, ...rows.map(r => r.actor.length)),
    action: Math.max(10, ...rows.map(r => r.action.length)),
    ip: Math.max(9, ...rows.map(r => (r.ip || '—').length)),
    device: Math.max(8, ...rows.map(r => (r.device || '—').length)),
  }
  console.log([pad(`WHEN (${ZONE.split('/').pop()})`, w.at), pad('WHO', w.actor), pad('DID WHAT', w.action), pad('FROM IP', w.ip), pad('DEVICE', w.device)].join('  '))
  console.log('-'.repeat(w.at + w.actor + w.action + w.ip + w.device + 8))
  for (const r of rows) {
    console.log([pad(r.at, w.at), pad(r.actor, w.actor), pad(r.action, w.action), pad(r.ip || '—', w.ip), pad(r.device || '—', w.device)].join('  '))
    if (r.details) console.log(`${' '.repeat(w.at + 2)}${r.details}`)
  }
  console.log('')
  console.log(`${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}.`)

  const blank = rows.filter(r => !r.ip).length
  if (blank) {
    console.log(`${blank} of them predate the address being recorded — run again with --sessions to see where those people were signed in from.`)
  }
  console.log('A browser does not report a computer\'s make or model: a laptop reads as its operating system and browser. Phones send a model.')

  if (withSessions) {
    console.log('')
    console.log('SIGN-INS COVERING THIS JOB  (where those people were working from)')
    if (!sessions.length) {
      console.log('  none still on record — sessions are removed once they expire.')
    } else {
      for (const s of sessions) {
        console.log(`  ${pad(s.from, 16)}  ${pad(s.actor, 24)}  ${pad(s.ip || '—', 16)}  ${s.device || '—'}`)
      }
    }
  }
  console.log('')
}

/**
 * Where a repair lives, newest storage first — the same order the app reads
 * in: one row per record in erp_state_records, then the whole-list row in
 * store_records, then the legacy app_state blob.
 */
async function findRepair(wanted) {
  const shape = `r->>'id'             AS id,
                 r->>'ref'            AS ref,
                 r->>'productName'    AS device,
                 r->>'customerName'   AS customer,
                 r->>'status'         AS status,
                 r->>'intakeDate'     AS intake_date,
                 r->>'assignedToName' AS technician`
  const match = `(upper(r->>'ref') = upper($1) OR r->>'id' = $1)`

  // A row may hold one repair or the whole list; take both as a list.
  const asList = column => `jsonb_array_elements(
    CASE WHEN jsonb_typeof(${column}) = 'array' THEN ${column} ELSE jsonb_build_array(${column}) END
  ) AS r`

  const sources = [
    // The authoritative table. It keeps the whole repair in `payload`, and
    // falls back to its own columns for a row mirrored before payload existed.
    [`repairs`, `
      SELECT COALESCE(r.payload->>'id', r.id::text)      AS id,
             COALESCE(r.payload->>'ref', r.job_number)   AS ref,
             COALESCE(r.payload->>'productName',
                      NULLIF(trim(concat_ws(' ', r.device_brand, r.device_model)), ''),
                      r.device_type)                     AS device,
             COALESCE(r.payload->>'customerName', c.name, '')            AS customer,
             COALESCE(r.payload->>'status', r.status::text)              AS status,
             COALESCE(r.payload->>'intakeDate',
                      to_char(r.intake_date, 'YYYY-MM-DD'))              AS intake_date,
             COALESCE(r.payload->>'assignedToName', u.name, '')          AS technician
        FROM repairs r
        LEFT JOIN clients c ON c.id = r.client_id
        LEFT JOIN users   u ON u.id = r.assigned_to
       WHERE upper(r.job_number) = upper($1)
          OR r.payload->>'ref' = $1
          OR r.payload->>'id' = $1
          OR r.id::text = $1
       LIMIT 1`],
    // One row per repair in the row store.
    [`erp_state_records`, `SELECT ${shape} FROM erp_state_records, ${asList('payload')}
       WHERE key = 'deed_repairs_v2' AND ${match} LIMIT 1`],
    // The whole list in one row.
    [`store_records`, `SELECT ${shape} FROM store_records, ${asList('value')}
       WHERE key = 'deed_repairs_v2' AND ${match} LIMIT 1`],
    // The legacy blob, kept as text.
    [`app_state`, `SELECT ${shape} FROM app_state, ${asList('value::jsonb')}
       WHERE key = 'deed_repairs_v2' AND ${match} LIMIT 1`],
  ]

  const searched = []
  for (const [table, text] of sources) {
    // A table that does not exist on this server is simply the wrong place
    // to look, not a failure.
    const rows = await q(text, [wanted]).catch(() => null)
    searched.push([table, rows === null ? 'not on this server' : `${rows.length} match`])
    if (rows?.length) return rows[0]
  }
  // Say where it looked, so a miss points at the next thing to check rather
  // than at nothing at all.
  console.error(`Looked in: ${searched.map(([t, outcome]) => `${t} (${outcome})`).join(', ')}`)
  return null
}

/** The browser string is a later addition; older databases do not have it. */
async function hasUserAgent() {
  const rows = await q(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'audit_logs' AND column_name = 'user_agent' LIMIT 1`,
  )
  return rows.length > 0
}

main()
  .catch(err => { console.error(`ERROR: ${err.message}`); process.exitCode = 1 })
  .finally(() => pool.end())
