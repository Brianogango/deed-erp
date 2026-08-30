import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { applyProviderDeliveryStatus } from '@/lib/notifications/provider-status'
import { recordInboundSms } from '@/lib/notifications/sms-conversations'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const token = String(process.env.TWILIO_AUTH_TOKEN || '').trim()
  if (!token) return NextResponse.json({ error: 'Twilio auth token not configured' }, { status: 503 })

  const form = await request.formData()
  const params: Record<string, string> = {}
  for (const [key, value] of form.entries()) params[key] = String(value)

  const signature = String(request.headers.get('x-twilio-signature') || '')
  const configuredBase = String(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/$/, '')
  const validationUrl = configuredBase
    ? `${configuredBase}${request.nextUrl.pathname}`
    : request.nextUrl.toString()

  if (!signature || !twilio.validateRequest(token, signature, validationUrl, params)) {
    return NextResponse.json({ error: 'Invalid Twilio webhook signature' }, { status: 401 })
  }

  const messageId = params.MessageSid || params.SmsSid
  const status = params.MessageStatus || params.SmsStatus
  const inbound = Boolean(
    messageId
    && params.From
    && params.Body
    && (!status || String(status).toLowerCase() === 'received')
  )

  if (inbound) {
    await recordInboundSms({
      provider: 'twilio',
      providerMessageId: messageId,
      from: params.From,
      to: params.To || null,
      body: params.Body,
      metadata: params,
    })
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    })
  }

  if (messageId && status) {
    await applyProviderDeliveryStatus({
      provider: 'twilio',
      messageId,
      status,
      errorCode: params.ErrorCode || null,
      error: params.ErrorMessage || null,
      raw: params,
    })
  }

  return NextResponse.json({ ok: true })
}
