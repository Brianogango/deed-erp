import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { CHAT_LIMITS, ChatError, listMessages, requireMember, sendMessage, type ChatAttachment, type ChatRecordLink } from '@/lib/chat/chat.server'
import { validateFileContent } from '@/lib/file-validation'
import { putObject } from '@/lib/infra/object-store'

export const dynamic = 'force-dynamic'

const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv', 'text/plain',
])

const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/

/** GET ?before=ISO | ?after=ISO — messages, oldest first. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const { id } = await params
    const sp = request.nextUrl.searchParams
    const before = sp.get('before') ?? undefined
    const after = sp.get('after') ?? undefined
    const messages = await listMessages(session.user.id, id, {
      before: before && ISO.test(before) ? before : undefined,
      after: after && ISO.test(after) ? after : undefined,
    })
    return NextResponse.json({ messages }, { headers: { 'Cache-Control': 'no-store' } })
  })
}

/** POST JSON { body, record } or multipart (body, record as JSON, file). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const { id } = await params
    let body = ''
    let record: ChatRecordLink | null = null
    let attachment: ChatAttachment | null = null
    if ((request.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      await requireMember(id, session.user.id)
      const form = await request.formData()
      body = String(form.get('body') ?? '')
      try { record = form.get('record') ? JSON.parse(String(form.get('record'))) : null } catch { record = null }
      const file = form.get('file')
      if (file && typeof file !== 'string') {
        if (file.size > CHAT_LIMITS.fileBytes) throw new ChatError('Files can be up to 10 MB')
        const type = String(file.type || '').toLowerCase()
        if (!ALLOWED_TYPES.has(type)) throw new ChatError('Send photos, PDFs, Word, Excel, CSV or text files')
        const buffer = Buffer.from(await file.arrayBuffer())
        const check = validateFileContent(buffer, type)
        if (!check.ok) throw new ChatError(check.error)
        const name = String(file.name || 'file').replace(/[\\/\0]/g, '_').slice(0, 120)
        const ext = path.extname(name).replace(/[^.a-zA-Z0-9]/g, '').slice(0, 10)
        const key = `chat/${id.replace(/[^a-zA-Z0-9-]/g, '')}/${randomUUID()}${ext}`
        await putObject({ bucket: 'uploads', key, body: buffer, contentType: type })
        attachment = { key, name, contentType: type, size: buffer.length }
      }
    } else {
      const json = await request.json().catch(() => ({})) as { body?: string; record?: ChatRecordLink }
      body = String(json.body ?? '')
      record = json.record ?? null
    }
    const message = await sendMessage(session.user.id, id, { body, record, attachment })
    return NextResponse.json({ message }, { status: 201 })
  })
}
