import { NextRequest, NextResponse } from 'next/server'
import { lookupRepair } from '@/lib/portal-repair-server'
import { findRepairInPrisma } from '@/lib/repair-mirror'
import { publishNotificationEvent } from '@/lib/notifications/service'
import { getServerSession } from '@/lib/auth/server'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  MAX_MESSAGE_LENGTH,
  addMessageStored,
  getMessagesStored,
  markMessagesReadStored,
} from '@/lib/portal-repair-messages'
import { cleanPortalText, clientIp, guardPortalRoute } from '@/lib/portal/portal-guard.server'


/**
 * A client wrote: the job's technician, the front desk and the workshop lead
 * get a bell notification and a phone push, opening the chat. A burst of
 * messages within ten minutes is one alert.
 */
async function alertStaff(ref: string, senderName: string, text: string) {
  try {
    const repair = await findRepairInPrisma(ref).catch(() => null)
    const repairRef = String(repair?.ref ?? ref)
    const window10m = Math.floor(Date.now() / 600_000)
    await publishNotificationEvent({
      eventType: 'repair.client_message',
      entityType: 'repair',
      entityId: String(repair?.id ?? repairRef),
      userIds: [repair?.assignedTechnicianId].filter(Boolean) as string[],
      title: `${senderName} wrote about ${repairRef}`,
      body: `${repair?.productName ? `${repair.productName}: ` : ''}${text.slice(0, 200)}`,
      actionUrl: `/repairs?id=${encodeURIComponent(String(repair?.id ?? repairRef))}&repairTab=chat`,
      idempotencyKey: `repair-client-message:${repairRef}:${window10m}`,
    })
  } catch (err) {
    console.error('[portal messages] staff alert failed:', err)
  }
}

async function handleGET(
  req: NextRequest,
  { params }: { params: Promise<{ ref: string }> }
) {
  const resolvedParams = await params
  const ref = decodeURIComponent(resolvedParams.ref)
  if (!await lookupRepair(ref)) {
    return NextResponse.json({ error: 'Repair not found.' }, { status: 404 })
  }
  const by = req.nextUrl.searchParams.get('by') as 'customer' | 'staff' | null
  // Marking the client's messages read clears the staff alert: staff only.
  if (by === 'staff' && await getServerSession()) await markMessagesReadStored(ref, 'staff')
  else if (by === 'customer') await markMessagesReadStored(ref, 'customer')
  return NextResponse.json({ messages: await getMessagesStored(ref) })
}

async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ ref: string }> }
) {
  const resolvedParams = await params
  // The sibling portal write endpoints (approve, payment-confirmation) are all
  // rate limited; this one was not, leaving an unauthenticated POST open.
  const rl = await checkRateLimit(`portal-message:${clientIp(req)}`, 30, 3600)
  if (!rl.success) {
    return NextResponse.json(
      { error: 'Too many messages. Please wait before sending another.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    )
  }

  const ref = decodeURIComponent(resolvedParams.ref)
  if (!await lookupRepair(ref)) {
    return NextResponse.json({ error: 'Repair not found.' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({})) as { sender?: 'customer' | 'staff'; senderName?: string; text?: string }
  const text = cleanPortalText(body.text, MAX_MESSAGE_LENGTH + 1, true)
  if (!text) {
    return NextResponse.json({ error: 'Message text is required.' }, { status: 400 })
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.` }, { status: 413 })
  }

  // Only authenticated staff can post as 'staff' — unauthenticated callers are customers
  let sender: 'customer' | 'staff' = 'customer'
  let senderName = cleanPortalText(body.senderName, 120) || 'Customer'

  if (body.sender === 'staff') {
    const session = await getServerSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required to post as staff.' }, { status: 401 })
    }
    sender = 'staff'
    senderName = session.user.name ?? senderName
  }

  const message = await addMessageStored(ref, {
    sender,
    senderName,
    text,
    timestamp: new Date().toISOString(),
    read: false,
  })
  if (sender === 'customer') void alertStaff(ref, senderName, text)
  return NextResponse.json({ message }, { status: 201 })
}

export const GET = guardPortalRoute('messages-read', 1500, handleGET)
export const POST = guardPortalRoute('messages-send', 60, handlePOST)
