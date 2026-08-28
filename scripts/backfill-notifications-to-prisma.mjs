import 'dotenv/config'
import { Pool } from 'pg'
import crypto from 'node:crypto'

const connectionString =
  process.env.deed_erp_POSTGRES_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL

if (!connectionString) {
  console.error('No database URL found.')
  process.exit(1)
}

const pool = new Pool({ connectionString, ssl: false })

function asIso(value) {
  const d = new Date(value || Date.now())
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

try {
  const { rows } = await pool.query("SELECT value FROM app_state WHERE key = 'deed_notifications' LIMIT 1")
  if (!rows.length) {
    console.log('No legacy deed_notifications blob found; nothing to backfill.')
    process.exit(0)
  }

  let legacy = []
  try { legacy = JSON.parse(rows[0].value) } catch {}
  if (!Array.isArray(legacy)) {
    console.log('Legacy deed_notifications is not an array; nothing to backfill.')
    process.exit(0)
  }

  let inserted = 0
  let skipped = 0
  for (const n of legacy) {
    if (!n?.userId || !n?.id) { skipped++; continue }
    const idempotencyKey = `legacy-notification:${String(n.id)}`
    const eventId = crypto.randomUUID()
    const createdAt = asIso(n.createdAt)
    const result = await pool.query(
      `INSERT INTO notification_events
        (id, event_type, entity_type, entity_id, severity, priority, title, body, action_url, metadata, routing, idempotency_key, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$13)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        eventId,
        `legacy.${String(n.type || 'system')}`,
        n.module ? String(n.module) : null,
        n.entityKey ? String(n.entityKey) : null,
        n.icon === '🚨' ? 'critical' : 'info',
        n.icon === '🚨' ? 'urgent' : 'normal',
        String(n.title || 'Notification'),
        String(n.body || ''),
        n.path ? String(n.path) : null,
        JSON.stringify({ legacyId: n.id, legacyIcon: n.icon, legacyModule: n.module, legacyEntityKey: n.entityKey }),
        JSON.stringify({ userIds: [String(n.userId)], channels: ['in_app'] }),
        idempotencyKey,
        createdAt,
      ],
    )
    if (!result.rows.length) { skipped++; continue }
    const savedEventId = result.rows[0].id
    await pool.query(
      `INSERT INTO notification_recipients
        (event_id, user_id, read_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$4)
       ON CONFLICT (event_id, user_id) DO NOTHING`,
      [savedEventId, String(n.userId), n.read || n.readAt ? asIso(n.readAt || n.createdAt) : null, createdAt],
    )
    await pool.query(
      `INSERT INTO notification_outbox (event_id, status, processed_at)
       VALUES ($1,'processed',NOW())
       ON CONFLICT (event_id) DO NOTHING`,
      [savedEventId],
    )
    inserted++
  }

  console.log(`Legacy notification backfill complete. Inserted ${inserted}; skipped/existing ${skipped}.`)
} catch (error) {
  console.error('Notification backfill failed:', error)
  process.exitCode = 1
} finally {
  await pool.end()
}
