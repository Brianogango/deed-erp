import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { applyProviderDeliveryStatus } from '@/lib/notifications/provider-status'

export const dynamic = 'force-dynamic'

function verifySharedSecret(request: NextRequest) {
  const expected = String(process.env.NOTIFICATION_WEBHOOK_SECRET || '').trim()
  const supplied = String(request.headers.get('x-notification-webhook-secret') || request.nextUrl.searchParams.get('secret') || '').trim()
  if (!expected || !supplied || expected.length !== supplied.length) return false
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)) } catch { return false }
}

function verifySignedWebhook(raw: string, request: NextRequest) {
  const publicKey = String(process.env.SENDGRID_WEBHOOK_PUBLIC_KEY || '').trim()
  const signature = String(request.headers.get('x-twilio-email-event-webhook-signature') || '').trim()
  const timestamp = String(request.headers.get('x-twilio-email-event-webhook-timestamp') || '').trim()
  if (!publicKey || !signature || !timestamp) return false
  try {
    return crypto.verify(
      'sha256',
      Buffer.from(timestamp + raw),
      publicKey,
      Buffer.from(signature, 'base64'),
    )
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  const raw = await request.text()
  if (!verifySignedWebhook(raw, request) && !verifySharedSecret(request)) {
    return NextResponse.json({ error: 'Invalid SendGrid webhook signature' }, { status: 401 })
  }

  const events = JSON.parse(raw || '[]')
  let handled = 0
  for (const item of Array.isArray(events) ? events : []) {
    const messageId = String(item.sg_message_id || item['smtp-id'] || '').replace(/^<|>$/g, '')
    if (!messageId || !item.event) continue
    let result = await applyProviderDeliveryStatus({
      provider: 'sendgrid',
      messageId,
      status: String(item.event),
      error: item.reason || item.response || null,
      raw: item,
      occurredAt: item.timestamp ? new Date(Number(item.timestamp) * 1000) : new Date(),
    })
    if (!result.matched && messageId.includes('.')) {
      result = await applyProviderDeliveryStatus({
        provider: 'sendgrid',
        messageId: messageId.split('.')[0],
        status: String(item.event),
        error: item.reason || item.response || null,
        raw: item,
      })
    }
    if (result.matched) handled += 1
  }
  return NextResponse.json({ ok: true, handled })
}
