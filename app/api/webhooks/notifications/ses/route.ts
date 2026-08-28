import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { applyProviderDeliveryStatus } from '@/lib/notifications/provider-status'

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
    const certUrl = new URL(body.SigningCertURL)
    const allowed = certUrl.protocol === 'https:' &&
      (certUrl.hostname === 'sns.amazonaws.com' || /^sns\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/.test(certUrl.hostname))
    if (!allowed) return false

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    let cert = ''
    try {
      const response = await fetch(certUrl, { signal: controller.signal })
      if (!response.ok) return false
      cert = await response.text()
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
    const url = new URL(body.SubscribeURL)
    if (url.protocol !== 'https:' || !url.hostname.endsWith('amazonaws.com')) {
      return NextResponse.json({ error: 'Invalid SNS subscribe URL' }, { status: 400 })
    }
    await fetch(url)
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
