import { NextRequest, NextResponse } from 'next/server'

import { applyProviderDeliveryStatus } from '@/lib/notifications/provider-status'
import {
  mapTelerivetStatus,
  parseTelerivetWebhook,
  telerivetWebhookSecret,
  verifyTelerivetWebhookSecret,
} from '@/lib/integrations/telerivet'

export const dynamic = 'force-dynamic'

async function readPayload(request: NextRequest): Promise<Record<string, unknown>> {
  const contentType = String(request.headers.get('content-type') || '')
  if (contentType.includes('application/json')) {
    const body = await request.json().catch(() => ({}))
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
  }
  const form = await request.formData().catch(() => null)
  if (!form) return {}
  const params: Record<string, unknown> = {}
  for (const [key, value] of form.entries()) params[key] = String(value)
  return params
}

export async function POST(request: NextRequest) {
  if (!telerivetWebhookSecret()) {
    return NextResponse.json({ error: 'Telerivet webhook secret not configured' }, { status: 503 })
  }

  const payload = parseTelerivetWebhook(await readPayload(request))
  if (!verifyTelerivetWebhookSecret(payload.secret)) {
    return NextResponse.json({ error: 'Invalid Telerivet webhook secret' }, { status: 401 })
  }

  const status = mapTelerivetStatus(payload.status)
  if (payload.id && status) {
    await applyProviderDeliveryStatus({
      provider: 'telerivet',
      messageId: payload.id,
      status,
      error: payload.error_message || null,
      raw: payload,
    })
  }

  return NextResponse.json({ ok: true })
}
