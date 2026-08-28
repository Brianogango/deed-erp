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
  const notificationBlob = await pool.query("SELECT value FROM app_state WHERE key = 'deed_notifications' LIMIT 1")
  let legacy = []
  if (notificationBlob.rows.length) {
    try { legacy = JSON.parse(notificationBlob.rows[0].value) } catch {}
  }
  if (!Array.isArray(legacy)) legacy = []

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

  console.log(`Legacy bell notification backfill complete. Inserted ${inserted}; skipped/existing ${skipped}.`)

  const documentBlob = await pool.query("SELECT value FROM app_state WHERE key = 'deed_documentEmailSends' LIMIT 1")
  let documentSends = []
  if (documentBlob.rows.length) {
    try { documentSends = JSON.parse(documentBlob.rows[0].value) } catch {}
  }
  if (!Array.isArray(documentSends)) documentSends = []

  let documentInserted = 0
  let documentSkipped = 0
  for (const send of documentSends) {
    if (!send?.documentId || !send?.documentType) { documentSkipped++; continue }

    const legacyId = String(send.id || '')
    const fingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify({
        documentType: send.documentType,
        documentId: send.documentId,
        to: send.to,
        channel: send.channel || 'email',
        sentAt: send.sentAt,
        messageId: send.messageId,
      }))
      .digest('hex')
      .slice(0, 32)
    const idempotencyKey = `legacy-document-send:${legacyId || fingerprint}`
    const eventId = crypto.randomUUID()
    const deliveryId = crypto.randomUUID()
    const sentAt = asIso(send.sentAt)
    const successful = String(send.status || '').toLowerCase() === 'success'
    const channel = String(send.channel || 'email') === 'whatsapp' ? 'whatsapp' : 'email'

    const result = await pool.query(
      `INSERT INTO notification_events
        (id, event_type, entity_type, entity_id, actor_user_id, severity, priority, title, body, metadata, routing, idempotency_key, created_at, updated_at)
       VALUES ($1,'document.send',$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'{}'::jsonb,$10,$11,$11)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        eventId,
        String(send.documentType),
        String(send.documentId),
        send.sentById ? String(send.sentById) : null,
        successful ? 'success' : 'warning',
        successful ? 'normal' : 'high',
        String(send.subject || `${send.documentRef || send.documentId} document send`),
        successful
          ? `${send.documentRef || send.documentId} sent via ${channel}.`
          : `${send.documentRef || send.documentId} failed to send via ${channel}.`,
        JSON.stringify({
          legacyId: send.id || null,
          documentType: send.documentType,
          documentId: send.documentId,
          documentRef: send.documentRef || '',
          subject: send.subject || null,
          sentByName: send.sentByName || null,
        }),
        idempotencyKey,
        sentAt,
      ],
    )
    if (!result.rows.length) { documentSkipped++; continue }

    await pool.query(
      `INSERT INTO notification_deliveries
        (id, event_id, channel, destination, provider, provider_message_id, status, attempt_count, last_attempt_at, sent_at, failed_at, last_error, idempotency_key, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,$11,$12,$13::jsonb,$8,$8)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        deliveryId,
        result.rows[0].id,
        channel,
        send.to ? String(send.to) : null,
        channel,
        send.messageId ? String(send.messageId) : null,
        successful ? 'sent' : 'failed',
        sentAt,
        successful ? sentAt : null,
        successful ? null : sentAt,
        send.error ? String(send.error) : null,
        `${idempotencyKey}:${channel}`,
        JSON.stringify({
          cc: Array.isArray(send.cc) ? send.cc.map(String) : [],
          kind: send.kind || null,
          source: 'legacy-document-send-backfill',
        }),
      ],
    )
    documentInserted++
  }

  console.log(`Legacy document-send backfill complete. Inserted ${documentInserted}; skipped/existing ${documentSkipped}.`)
} catch (error) {
  console.error('Notification backfill failed:', error)
  process.exitCode = 1
} finally {
  await pool.end()
}
