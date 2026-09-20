// Backfill whole-collection app_state values into the row-based Prisma
// projection. Idempotent and non-destructive: app_state remains as a read-only
// rollback source until parity is certified.
//
//   node scripts/backfill-app-state-to-prisma.mjs --dry-run
//   node scripts/backfill-app-state-to-prisma.mjs

import 'dotenv/config'
import { createHash } from 'crypto'
import pg from 'pg'

const { Pool } = pg
const dryRun = process.argv.includes('--dry-run')
const connectionString =
  process.env.deed_erp_POSTGRES_URL
  || process.env.POSTGRES_URL
  || process.env.DATABASE_URL

if (!connectionString) {
  console.error('Missing deed_erp_POSTGRES_URL, POSTGRES_URL, or DATABASE_URL')
  process.exit(1)
}

function parseValue(raw) {
  try { return JSON.parse(raw) } catch { return raw }
}

function identityCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  for (const field of ['id', 'ref', 'code', 'key', 'number', 'name']) {
    const candidate = value[field]
    if ((typeof candidate === 'string' && candidate.trim()) || typeof candidate === 'number') {
      return `${field}:${String(candidate).trim()}`
    }
  }
  return null
}

function compact(value, max = 220) {
  if (value.length <= max) return value
  return `${value.slice(0, max - 17)}:${createHash('sha256').update(value).digest('hex').slice(0, 16)}`
}

function projectionRows(key, values) {
  const seen = new Map()
  return values.map((payload, position) => {
    const fallback = `hash:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`
    const base = compact(identityCandidate(payload) || fallback)
    const occurrence = seen.get(base) || 0
    seen.set(base, occurrence + 1)
    const recordKey = occurrence === 0 ? base : compact(`${base}#${occurrence + 1}`)
    const id = `${key}:${createHash('sha256').update(recordKey).digest('hex').slice(0, 32)}`
    return { id, key, recordKey, position, payload }
  })
}

const pool = new Pool({ connectionString })

try {
  const { rows } = await pool.query(
    "SELECT key, value FROM app_state WHERE key LIKE 'deed_%' ORDER BY key",
  )
  let collections = 0
  let values = 0
  let records = 0

  for (const row of rows) {
    const parsed = parseValue(row.value)
    if (Array.isArray(parsed)) {
      collections += 1
      records += parsed.length
    } else {
      values += 1
    }
  }

  console.log(JSON.stringify({
    dryRun,
    keys: rows.length,
    collections,
    values,
    records,
  }, null, 2))

  if (dryRun) process.exit(0)

  for (const row of rows) {
    const parsed = parseValue(row.value)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      if (Array.isArray(parsed)) {
        await client.query(
          `INSERT INTO erp_state_keys (key, kind, value, version, created_at, updated_at)
           VALUES ($1, 'collection', NULL, 1, NOW(), NOW())
           ON CONFLICT (key) DO UPDATE
             SET kind = 'collection', value = NULL,
                 version = erp_state_keys.version + 1, updated_at = NOW()`,
          [row.key],
        )
        await client.query('DELETE FROM erp_state_records WHERE key = $1', [row.key])
        const projected = projectionRows(row.key, parsed)
        for (let offset = 0; offset < projected.length; offset += 250) {
          const chunk = projected.slice(offset, offset + 250)
          const params = []
          const tuples = chunk.map((item, index) => {
            const base = index * 5
            params.push(item.id, item.key, item.recordKey, item.position, JSON.stringify(item.payload))
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb, NOW(), NOW())`
          })
          await client.query(
            `INSERT INTO erp_state_records
               (id, key, record_key, position, payload, created_at, updated_at)
             VALUES ${tuples.join(', ')}
             ON CONFLICT (key, record_key) DO UPDATE
               SET position = EXCLUDED.position,
                   payload = EXCLUDED.payload,
                   updated_at = NOW()`,
            params,
          )
        }
      } else {
        await client.query('DELETE FROM erp_state_records WHERE key = $1', [row.key])
        await client.query(
          `INSERT INTO erp_state_keys (key, kind, value, version, created_at, updated_at)
           VALUES ($1, 'value', $2::jsonb, 1, NOW(), NOW())
           ON CONFLICT (key) DO UPDATE
             SET kind = 'value', value = EXCLUDED.value,
                 version = erp_state_keys.version + 1, updated_at = NOW()`,
          [row.key, JSON.stringify(parsed)],
        )
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  console.log('Backfill completed. Legacy app_state rows were retained for rollback/parity checks.')
} finally {
  await pool.end()
}
