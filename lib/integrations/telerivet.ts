import crypto from 'node:crypto'

export type TelerivetSendResult = {
  success: boolean
  messageId?: string
  error?: string
  errorCode?: string
  httpStatus?: number
  status?: string
}

export type TelerivetWebhookPayload = {
  secret?: string
  event?: string
  id?: string
  status?: string
  error_message?: string
  [key: string]: unknown
}

function timingSafeEqual(left: string, right: string): boolean {
  const a = crypto.createHash('sha256').update(left).digest()
  const b = crypto.createHash('sha256').update(right).digest()
  return crypto.timingSafeEqual(a, b)
}

export function telerivetWebhookSecret(): string {
  return String(process.env.TELERIVET_WEBHOOK_SECRET || '').trim()
}

export function verifyTelerivetWebhookSecret(provided: string | undefined): boolean {
  const expected = telerivetWebhookSecret()
  if (!expected || !provided) return false
  return timingSafeEqual(provided, expected)
}

export function parseTelerivetWebhook(input: Record<string, unknown>): TelerivetWebhookPayload {
  const asString = (value: unknown) => (value == null ? undefined : String(value))
  return {
    ...input,
    secret: asString(input.secret),
    event: asString(input.event),
    id: asString(input.id || input.message_id),
    status: asString(input.status),
    error_message: asString(input.error_message || input.error),
  }
}

export function mapTelerivetStatus(status: string | undefined): string | null {
  const value = String(status || '').toLowerCase()
  if (!value) return null
  if (value === 'delivered') return 'delivered'
  if (value === 'sent' || value === 'queued') return value === 'queued' ? 'queued' : 'sent'
  if (['failed', 'not_delivered', 'cancelled', 'undelivered'].includes(value)) return 'failed'
  return value
}

export async function sendTelerivetSms(input: {
  to: string
  message: string
}): Promise<TelerivetSendResult> {
  const apiKey = String(process.env.TELERIVET_API_KEY || '').trim()
  const projectId = String(process.env.TELERIVET_PROJECT_ID || '').trim()
  const phoneId = String(process.env.TELERIVET_PHONE_ID || '').trim()
  const timeoutMs = Number(process.env.TELERIVET_HTTP_TIMEOUT_MS || 10_000)

  if (!apiKey || !projectId) {
    return {
      success: false,
      error: 'SMS not configured. Set TELERIVET_API_KEY and TELERIVET_PROJECT_ID.',
      errorCode: 'not_configured',
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? Math.max(1_000, timeoutMs) : 10_000)
  try {
    const body: Record<string, string> = {
      content: input.message,
      to_number: input.to,
    }
    if (phoneId) body.phone_id = phoneId

    const response = await fetch(
      `https://api.telerivet.com/v1/projects/${encodeURIComponent(projectId)}/messages/send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    )

    const raw = await response.json().catch(() => ({})) as Record<string, any>
    if (!response.ok) {
      const message = raw?.error?.message || raw?.message || `Telerivet HTTP ${response.status}`
      return {
        success: false,
        error: message,
        errorCode: raw?.error?.code != null ? String(raw.error.code) : String(response.status),
        httpStatus: response.status,
      }
    }

    return {
      success: true,
      messageId: raw?.id ? String(raw.id) : undefined,
      status: raw?.status ? String(raw.status) : undefined,
      httpStatus: response.status,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Telerivet request failed',
      errorCode: 'network',
    }
  } finally {
    clearTimeout(timer)
  }
}
