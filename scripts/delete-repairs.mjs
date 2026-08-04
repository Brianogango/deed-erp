#!/usr/bin/env node
/**
 * Ops helper: delete specific repair jobs (and optional contacts) by ref/id.
 *
 *   node scripts/delete-repairs.mjs --request ops/delete-repairs-request.json
 *   node scripts/delete-repairs.mjs --ref REP-861745 --apply
 *
 * Default is dry-run. Pass --apply (or request.apply=true) to write.
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
let refs = allArgs('--ref').map(s => String(s).trim()).filter(Boolean)
let contactIds = allArgs('--contact-id').map(s => String(s).trim()).filter(Boolean)
let apply = process.argv.includes('--apply')

if (requestPath) {
  const abs = resolve(ROOT, requestPath)
  if (!existsSync(abs)) fail(`Request file not found: ${abs}`)
  const parsed = JSON.parse(readFileSync(abs, 'utf8'))
  const fromRefs = Array.isArray(parsed?.refs) ? parsed.refs : []
  const fromContacts = Array.isArray(parsed?.contactIds) ? parsed.contactIds : []
  refs = [...refs, ...fromRefs.map(s => String(s).trim()).filter(Boolean)]
  contactIds = [...contactIds, ...fromContacts.map(s => String(s).trim()).filter(Boolean)]
  if (parsed?.apply === true) apply = true
}

refs = [...new Set(refs.map(r => r.toUpperCase()))]
contactIds = [...new Set(contactIds)]
if (!refs.length && !contactIds.length) fail('Provide --ref / refs[] and/or --contact-id / contactIds[]')

const pool = new Pool({ connectionString })

async function loadJson(client, key) {
  const { rows } = await client.query(`SELECT value FROM app_state WHERE key = $1`, [key])
  if (!rows.length) return null
  const raw = rows[0].value
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}

async function saveJson(client, key, value) {
  const payload = JSON.stringify(value)
  const updatedAt = new Date().toISOString()
  await client.query(
    `INSERT INTO app_state (key, value, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [key, payload, updatedAt],
  )
}

async function tableExists(client, name) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [name],
  )
  return rows.length > 0
}

try {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const repairs = (await loadJson(client, 'deed_repairs_v2')) || []
    if (!Array.isArray(repairs)) fail('deed_repairs_v2 is not an array')

    const refSet = new Set(refs)
    const removedRepairs = repairs.filter(r => refSet.has(String(r?.ref ?? '').toUpperCase()))
    const keptRepairs = repairs.filter(r => !refSet.has(String(r?.ref ?? '').toUpperCase()))

    console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`)
    console.log(`Repairs total: ${repairs.length}`)
    console.log(`Refs requested: ${refs.join(', ') || '(none)'}`)
    console.log(`Matched repairs: ${removedRepairs.length}`)
    console.log(JSON.stringify(removedRepairs.map(r => ({
      id: r.id,
      ref: r.ref,
      customerName: r.customerName,
      customerId: r.customerId,
      productName: r.productName,
      status: r.status,
      intakeDate: r.intakeDate,
    })), null, 2))

    if (removedRepairs.length !== refs.length) {
      const found = new Set(removedRepairs.map(r => String(r.ref).toUpperCase()))
      const missing = refs.filter(r => !found.has(r))
      if (missing.length) console.warn(`WARNING: refs not found in blob: ${missing.join(', ')}`)
    }

    // Optional contacts
    let contacts = null
    let removedContacts = []
    let keptContacts = null
    if (contactIds.length) {
      contacts = (await loadJson(client, 'deed_contacts')) || []
      if (!Array.isArray(contacts)) fail('deed_contacts is not an array')
      const idSet = new Set(contactIds)
      removedContacts = contacts.filter(c => idSet.has(String(c?.id ?? '')))
      keptContacts = contacts.filter(c => !idSet.has(String(c?.id ?? '')))
      console.log(`Matched contacts: ${removedContacts.length}`)
      console.log(JSON.stringify(removedContacts.map(c => ({
        id: c.id,
        name: c.name,
        phone: c.phone || c.mobile || '',
        type: c.type,
      })), null, 2))
    }

    if (apply) {
      if (removedRepairs.length) {
        await saveJson(client, 'deed_repairs_v2', keptRepairs)
        console.log(`deed_repairs_v2: ${repairs.length} → ${keptRepairs.length}`)
      }

      if (keptContacts) {
        await saveJson(client, 'deed_contacts', keptContacts)
        console.log(`deed_contacts: ${contacts.length} → ${keptContacts.length}`)
      }

      // Prisma mirror (job_number = repair ref)
      if (removedRepairs.length && (await tableExists(client, 'repairs'))) {
        const jobNumbers = removedRepairs.map(r => String(r.ref))
        const ids = removedRepairs.map(r => r.id).filter(Boolean)

        // Child tables first when present
        for (const table of ['repair_parts', 'repair_diagnostics', 'repair_stages', 'repair_client_communications']) {
          if (!(await tableExists(client, table))) continue
          const res = await client.query(
            `DELETE FROM ${table} WHERE repair_id IN (SELECT id FROM repairs WHERE job_number = ANY($1::text[]) OR id = ANY($2::uuid[]))`,
            [jobNumbers, ids],
          )
          if (res.rowCount) console.log(`  ${table}: ${res.rowCount}`)
        }

        const res = await client.query(
          `DELETE FROM repairs WHERE job_number = ANY($1::text[]) OR id = ANY($2::uuid[])`,
          [jobNumbers, ids],
        )
        console.log(`  repairs (prisma): ${res.rowCount ?? 0}`)
      }

      // Drop portal photo / report blob keys if present
      for (const r of removedRepairs) {
        const keys = [
          `repair_photos_${r.ref}`,
          `repair_payment_proof_${r.ref}`,
        ]
        for (const key of keys) {
          const del = await client.query(`DELETE FROM app_state WHERE key = $1`, [key])
          if (del.rowCount) console.log(`  removed app_state key: ${key}`)
        }
      }

      console.log('DONE — sample repair removed')
    } else {
      console.log('Dry-run only — pass apply=true / --apply to delete')
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
} finally {
  await pool.end()
}
