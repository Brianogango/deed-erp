import { NextRequest, NextResponse } from 'next/server'
import { getMessages, addMessage, markMessagesRead } from '@/lib/portal-repairs'
import { lookupRepair } from '@/lib/portal-repair-server'

export async function GET(
  req: NextRequest,
  { params }: { params: { ref: string } }
) {
  const ref = decodeURIComponent(params.ref)
  if (!await lookupRepair(ref)) {
    return NextResponse.json({ error: 'Repair not found.' }, { status: 404 })
  }
  const by = req.nextUrl.searchParams.get('by') as 'customer' | 'staff' | null
  if (by) markMessagesRead(ref, by)
  return NextResponse.json({ messages: getMessages(ref) })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } }
) {
  const ref = decodeURIComponent(params.ref)
  if (!await lookupRepair(ref)) {
    return NextResponse.json({ error: 'Repair not found.' }, { status: 404 })
  }
  const body = await req.json() as { sender: 'customer' | 'staff'; senderName: string; text: string }
  if (!body.text?.trim()) {
    return NextResponse.json({ error: 'Message text is required.' }, { status: 400 })
  }
  const message = addMessage(ref, {
    sender: body.sender,
    senderName: body.senderName,
    text: body.text.trim(),
    timestamp: new Date().toISOString(),
    read: false,
  })
  return NextResponse.json({ message }, { status: 201 })
}
