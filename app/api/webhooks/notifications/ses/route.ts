import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { applyProviderDeliveryStatus } from '@/lib/notifications/provider-status'
import { isAllowedSnsHttpsUrl } from '@/lib/notifications/sns-url'

export const dynamic = 'force-dynamic'

type SnsEnvelope = Record<string, string>

function canonicalSnsString(body: SnsEnvelope): string {
  const fields = body.Type === 'SubscriptionConfirmation' || body.Type === 'UnsubscribeConfirmation'
    ? ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']
    : ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
  return fields
    .filter(key => body[key] != null)
    .map(key => `${key}\n${body[key]}\n`)
    .join('')
}

async function verifySns(body: SnsEnvelope): Promise<boolean> {
  try {
    if (!isAllowedSnsHttpsUrl(body.SigningCertURL)) return false
    const certUrl = new URL(body.SigningCertURL)
    if (!/^\/SimpleNotificationService-[A-Za-z0-9_-]+\.pem$/.test(certUrl.pathname)) return false

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    let cert = ''
    try {
      const response = await fetch(certUrl, { signal: controller.signal, redirect: 'error' })
      if (!response.ok) return false
      const length = Number(response.headers.get('content-length') || 0)
      if (length > 128 * 1024) return false
      cert = await response.text()
      if (cert.length > 128 * 1024 || !cert.includes('BEGIN CERTIFICATE')) return false
    } finally {
      clearTimeout(timeout)
    }

    const algorithm = body.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1'
    return crypto.verify(
      algorithm,
      Buffer.from(canonicalSnsString(body)),
      cert,
      Buffer.from(body.Signature, 'base64'),
    )
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as SnsEnvelope | null
  if (!body?.Type || !body.Signature || !body.SigningCertURL || !(await verifySns(body))) {
    return NextResponse.json({ error: 'Invalid SNS signature' }, { status: 401 })
  }

  if (body.Type === 'SubscriptionConfirmation' && body.SubscribeURL) {
    if (!isAllowedSnsHttpsUrl(body.SubscribeURL)) {
      return NextResponse.json({ error: 'Invalid SNS subscribe URL' }, { status: 400 })
    }
    const url = new URL(body.SubscribeURL)
    await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) })
    return NextResponse.json({ ok: true, subscribed: true })
  }

  if (body.Type !== 'Notification') return NextResponse.json({ ok: true, ignored: true })

  const message = JSON.parse(body.Message || '{}')
  const messageId = String(message?.mail?.messageId || '')
  if (!messageId) return NextResponse.json({ ok: true, ignored: true })

  const type = String(message.notificationType || message.eventType || '').toLowerCase()
  const status =
    type === 'delivery' ? 'delivered' :
    type === 'bounce' ? 'bounced' :
    type === 'complaint' ? 'complaint' :
    'sent'

  await applyProviderDeliveryStatus({
    provider: 'ses',
    messageId,
    status,
    error: type === 'bounce' ? JSON.stringify(message.bounce || {}).slice(0, 1000)
      : type === 'complaint' ? JSON.stringify(message.complaint || {}).slice(0, 1000)
      : null,
    raw: message,
  })

  return NextResponse.json({ ok: true })
}
