import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { applyProviderDeliveryStatus } from '@/lib/notifications/provider-status'

export const dynamic = 'force-dynamic'

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false
  try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)) } catch { return false }
}

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('hub.mode') || ''
  const token = request.nextUrl.searchParams.get('hub.verify_token') || ''
  const challenge = request.nextUrl.searchParams.get('hub.challenge') || ''
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || ''
  if (mode === 'subscribe' && expected && safeEqual(token, expected)) {
    return new NextResponse(challenge, { status: 200 })
  }
  return NextResponse.json({ error: 'Webhook verification failed' }, { status: 403 })
}

export async function POST(request: NextRequest) {
  const appSecret = String(process.env.WHATSAPP_APP_SECRET || '').trim()
  if (!appSecret) return NextResponse.json({ error: 'WhatsApp webhook signing secret not configured' }, { status: 503 })

  const raw = await request.text()
  const signature = String(request.headers.get('x-hub-signature-256') || '')
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(raw).digest('hex')
  if (!safeEqual(signature, expected)) {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 })
  }

  const body = JSON.parse(raw || '{}')
  let handled = 0
  for (const entry of Array.isArray(body.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      for (const status of Array.isArray(change?.value?.statuses) ? change.value.statuses : []) {
        if (!status?.id || !status?.status) continue
        const err = Array.isArray(status.errors) ? status.errors[0] : null
        await applyProviderDeliveryStatus({
          provider: 'whatsapp',
          messageId: String(status.id),
          status: String(status.status),
          errorCode: err?.code != null ? String(err.code) : null,
          error: err?.message || err?.title || null,
          raw: status,
          occurredAt: status.timestamp ? new Date(Number(status.timestamp) * 1000) : new Date(),
        })
        handled += 1
      }
    }
  }
  return NextResponse.json({ ok: true, handled })
}
