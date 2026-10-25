import { NextRequest, NextResponse } from 'next/server'
import { lookupRepair } from '@/lib/portal-repair-server'
import { getServerSession } from '@/lib/auth/server'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  MAX_MESSAGE_LENGTH,
  addMessageStored,
  getMessagesStored,
  markMessagesReadStored,
} from '@/lib/portal-repair-messages'
import { cleanPortalText, clientIp, guardPortalRoute } from '@/lib/portal/portal-guard.server'
import { isPortalPhoneVerificationRequired, portalPhoneAccessAllowed } from '@/lib/portal-verify'
import { loadAppState } from '@/lib/server-store'

/**
 * The message thread is private to the customer and the shop. A repair ref
 * alone is not enough (older ones are sequential and guessable): staff pass
 * with their session, the customer with the phone number on the repair.
 */
async function threadAccessAllowed(
  repair: { customerPhone?: string | null },
  phone: string | null | undefined,
) {
  const session = await getServerSession().catch(() => null)
  if (session) return true
  const state = await loadAppState(['deed_systemSettings'])
  return portalPhoneAccessAllowed(String(phone ?? '').slice(0, 80), repair, {
    phoneVerificationRequired: isPortalPhoneVerificationRequired(state['deed_systemSettings'] as any),
  })
}


async function handleGET(
  req: NextRequest,
  { params }: { params: Promise<{ ref: string }> }
) {
  const resolvedParams = await params
  const ref = decodeURIComponent(resolvedParams.ref)
  const repair = await lookupRepair(ref)
  if (!repair) {
    return NextResponse.json({ error: 'Repair not found.' }, { status: 404 })
  }
  if (!await threadAccessAllowed(repair, req.nextUrl.searchParams.get('phone'))) {
    return NextResponse.json({ error: 'Enter the phone number on this repair to see the messages.' }, { status: 403 })
  }
  const by = req.nextUrl.searchParams.get('by') as 'customer' | 'staff' | null
  if (by === 'customer' || by === 'staff') await markMessagesReadStored(ref, by)
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
  const repair = await lookupRepair(ref)
  if (!repair) {
    return NextResponse.json({ error: 'Repair not found.' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({})) as { sender?: 'customer' | 'staff'; senderName?: string; text?: string; verifyPhone?: string }
  if (!await threadAccessAllowed(repair, body.verifyPhone)) {
    return NextResponse.json({ error: 'Enter the phone number on this repair to send a message.' }, { status: 403 })
  }
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
  return NextResponse.json({ message }, { status: 201 })
}

export const GET = guardPortalRoute('messages-read', 1500, handleGET)
export const POST = guardPortalRoute('messages-send', 60, handlePOST)
