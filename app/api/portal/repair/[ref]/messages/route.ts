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

function clientIp(req: NextRequest) {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown'
}

export async function GET(
  req: NextRequest,
  { params }: { params: { ref: string } }
) {
  const ref = decodeURIComponent(params.ref)
  if (!await lookupRepair(ref)) {
    return NextResponse.json({ error: 'Repair not found.' }, { status: 404 })
  }
  const by = req.nextUrl.searchParams.get('by') as 'customer' | 'staff' | null
  if (by === 'customer' || by === 'staff') await markMessagesReadStored(ref, by)
  return NextResponse.json({ messages: await getMessagesStored(ref) })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } }
) {
  // The sibling portal write endpoints (approve, payment-confirmation) are all
  // rate limited; this one was not, leaving an unauthenticated POST open.
  const rl = await checkRateLimit(`portal-message:${clientIp(req)}`, 30, 3600)
  if (!rl.success) {
    return NextResponse.json(
      { error: 'Too many messages. Please wait before sending another.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    )
  }

  const ref = decodeURIComponent(params.ref)
  if (!await lookupRepair(ref)) {
    return NextResponse.json({ error: 'Repair not found.' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({})) as { sender?: 'customer' | 'staff'; senderName?: string; text?: string }
  const text = String(body.text ?? '').trim()
  if (!text) {
    return NextResponse.json({ error: 'Message text is required.' }, { status: 400 })
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.` }, { status: 413 })
  }

  // Only authenticated staff can post as 'staff' — unauthenticated callers are customers
  let sender: 'customer' | 'staff' = 'customer'
  let senderName = (body.senderName ?? '').trim().slice(0, 120) || 'Customer'

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
