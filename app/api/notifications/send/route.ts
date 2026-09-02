import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import prisma from '@/lib/prisma'
import { getServerSession } from '@/lib/auth/server'
import { publishNotificationEvent } from '@/lib/notifications/service'
import { runNotificationWorker } from '@/lib/notifications/worker'
import type { NotificationChannel } from '@/lib/notifications/types'

export const dynamic = 'force-dynamic'

const safeEqual = (a: string, b: string) => {
  if (!a || !b || a.length !== b.length) return false
  try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)) } catch { return false }
}

const contentHash = (value: unknown) =>
  crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)

function requestedChannels(params: any, defaults: NotificationChannel[]): NotificationChannel[] {
  const allowed = new Set<NotificationChannel>(['email', 'whatsapp', 'sms'])
  const raw = Array.isArray(params.channels)
    ? params.channels
    : params.channel && params.channel !== 'auto'
      ? [params.channel]
      : params.channel === 'auto'
        ? ['whatsapp']
        : defaults
  const clean = [...new Set(raw.filter((v: unknown) => allowed.has(v as NotificationChannel)))] as NotificationChannel[]
  return clean.length ? clean : defaults
}

function roleAllowed(role: string, type: string) {
  const rules: Record<string, string[]> = {
    repair: ['director', 'admin_officer', 'technical_lead', 'technician'],
    quote: ['director', 'admin_officer', 'technical_lead', 'sales_rep'],
    procurement: ['director', 'admin_officer', 'technical_lead', 'technician'],
    general: ['director', 'admin_officer', 'super_admin'],
  }
  return Boolean(rules[type]?.includes(role))
}

async function loadRepairRecipient(ref: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ref)
  const repair = await prisma.repair.findFirst({
    where: isUuid
      ? { OR: [{ id: ref }, { jobNumber: ref }] }
      : { jobNumber: ref },
    include: {
      client: { select: { name: true, email: true, phone: true, phoneAlt: true } },
    },
  })
  if (!repair) return null
  return {
    repair,
    recipient: {
      name: repair.client.name,
      email: repair.client.email,
      phone: repair.client.phone || repair.client.phoneAlt,
    },
  }
}

/**
 * Manual/specialized notification gateway.
 *
 * Security:
 * - internal calls require INTERNAL_API_SECRET;
 * - authenticated users are role-gated per business purpose;
 * - repair/quote customer destinations are loaded from the authoritative repair
 *   record instead of trusting a client-supplied phone/email;
 * - general arbitrary destinations are restricted to director/admin roles.
 *
 * All sends first create a durable event/outbox row. Provider work then runs
 * through the same retry/DLQ/delivery-status pipeline as automated events.
 */
export async function POST(request: NextRequest) {
  const internalSecret = String(process.env.INTERNAL_API_SECRET || '').trim()
  const callerSecret = String(request.headers.get('x-internal-secret') || '').trim()
  const internal = Boolean(internalSecret && safeEqual(callerSecret, internalSecret))

  const session = internal ? null : await getServerSession()
  if (!internal && !session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { type, ...params } = body
    if (!['repair', 'quote', 'procurement', 'general'].includes(String(type))) {
      return NextResponse.json({ error: 'Invalid notification type' }, { status: 400 })
    }
    if (!internal && !roleAllowed(session!.user.role, String(type))) {
      return NextResponse.json({ error: 'Forbidden — notification purpose not allowed for this role' }, { status: 403 })
    }

    const actorUserId = session?.user.id || null
    let event

    if (type === 'repair' || type === 'quote') {
      const repairRef = String(params.repairRef || '').trim()
      if (!repairRef) return NextResponse.json({ error: 'repairRef is required' }, { status: 400 })
      const record = await loadRepairRecipient(repairRef)
      if (!record) return NextResponse.json({ error: 'Repair record not found' }, { status: 404 })

      const channels = requestedChannels(params, type === 'quote' ? ['email', 'whatsapp', 'sms'] : ['whatsapp', 'sms'])
      const deviceName = [record.repair.deviceBrand, record.repair.deviceModel || record.repair.deviceType].filter(Boolean).join(' ')
      const quoteTotal = Number(params.quoteTotal || record.repair.estimatedCost || 0)
      const quoteRevision = type === 'quote' && Boolean(params.isRevision)
      const title = type === 'quote'
        ? `${quoteRevision ? 'Updated repair quotation' : 'Repair quotation ready'} — ${record.repair.jobNumber}`
        : `Repair update — ${record.repair.jobNumber}`
      const message = type === 'quote'
        ? `${quoteRevision ? 'Your repair quotation has been updated. Please review and approve the revised quote.' : 'Your repair quotation is ready.'} Repair: ${record.repair.jobNumber}. Device: ${deviceName}. Total: KES ${quoteTotal.toLocaleString('en-KE')}.${params.quoteUrl ? ` View: ${params.quoteUrl}` : ''}`
        : String(params.message || 'There is an update on your repair.')

      event = await publishNotificationEvent({
        eventType: type === 'quote' ? 'repair.quote_ready' : 'repair.customer_message',
        entityType: 'repair',
        entityId: record.repair.id,
        actorUserId,
        externalRecipients: [{
          ...record.recipient,
          channels,
        }],
        channels,
        severity: type === 'quote' ? 'attention' : 'info',
        title,
        body: message,
        actionUrl: params.quoteUrl || `/portal/repair/${encodeURIComponent(record.repair.jobNumber)}`,
        metadata: {
          emailSubject: title,
          emailText: message,
          whatsappText: message,
          smsText: message.slice(0, 480),
          quoteTotal,
        },
        idempotencyKey: String(body.idempotencyKey || `manual:${type}:${record.repair.id}:${contentHash({ channels, message, quoteTotal })}`),
      })
    } else if (type === 'procurement') {
      const repairRef = String(params.repairRef || '').trim()
      const items = Array.isArray(params.items) ? params.items : []
      const total = items.reduce((sum: number, item: any) => sum + Number(item.qty || 0) * Number(item.estimatedCost || 0), 0)
      const itemText = items.map((item: any) => `${item.productName || 'Item'} × ${item.qty || 0}`).join(', ')
      const message = `Parts request for repair ${repairRef}. Requested by ${params.technicianName || session?.user.name || 'ERP user'}. ${itemText}. Estimated total KES ${Math.round(total).toLocaleString('en-KE')}.${params.notes ? ` Notes: ${params.notes}` : ''}`
      event = await publishNotificationEvent({
        eventType: 'repair.parts_requested',
        entityType: 'repair',
        entityId: repairRef || null,
        actorUserId,
        roles: ['inventory_officer', 'admin_officer'],
        severity: String(params.urgency).toLowerCase() === 'urgent' ? 'critical' : 'attention',
        title: `Parts request — ${repairRef || 'repair'}`,
        body: message,
        actionUrl: '/purchase',
        metadata: { items, estimatedTotal: total },
        idempotencyKey: String(body.idempotencyKey || `parts-request:${repairRef}:${contentHash({ items, notes: params.notes })}`),
      })
    } else {
      // Arbitrary external messaging is intentionally administrator-only.
      const channels = requestedChannels(params, ['email'])
      const email = String(params.email || (params.channel === 'email' ? params.to : '') || '').trim() || null
      const phone = String(params.phone || (params.channel !== 'email' ? params.to : '') || '').trim() || null
      if (!email && !phone) return NextResponse.json({ error: 'Recipient email or phone is required' }, { status: 400 })
      const message = String(params.message || '').trim()
      if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 })
      const title = String(params.subject || 'Message from Deed Technologies').slice(0, 240)
      event = await publishNotificationEvent({
        eventType: 'system.manual_message',
        entityType: 'manual_message',
        actorUserId,
        externalRecipients: [{ name: params.name || null, email, phone, channels }],
        channels,
        severity: 'info',
        title,
        body: message,
        metadata: {
          emailSubject: title,
          emailText: message,
          whatsappText: message,
          smsText: message.slice(0, 480),
        },
        idempotencyKey: String(body.idempotencyKey || `manual-general:${contentHash({ email, phone, channels, title, message })}`),
      })
    }

    // Give interactive sends an immediate attempt while remaining durable if a
    // provider fails or the process terminates after the event was committed.
    await runNotificationWorker({ routeLimit: 20, deliveryLimit: 50, escalationLimit: 5 })
    const deliveries = await prisma.notificationDelivery.findMany({
      where: { eventId: event.id },
      select: {
        id: true,
        channel: true,
        provider: true,
        status: true,
        providerMessageId: true,
        lastError: true,
      },
    })

    return NextResponse.json({ success: true, eventId: event.id, deliveries })
  } catch (error) {
    console.error('[notifications/send] failed', error)
    return NextResponse.json({ error: 'Failed to queue notification' }, { status: 500 })
  }
}
