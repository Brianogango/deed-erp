import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import path from 'path'
import { mkdir, writeFile, readFile, unlink } from 'fs/promises'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

// Quotation / sales-order attachments (Odoo: documents attached to the order).
// Files live under .uploads/so-attachments/<soId>/; metadata is a JSON array
// in app_state so every browser sees the same attachment list.

type AttachmentMeta = {
  id: string
  name: string
  size: number
  contentType: string
  uploadedAt: string
  uploadedBy: string
  storagePath: string
}

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/webp',
])

const stateKey = (soId: string) => `so_attachments_${soId}`
const safeStem = (value: string) =>
  value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100) || 'attachment'

async function listAttachments(soId: string): Promise<AttachmentMeta[]> {
  const key = stateKey(soId)
  const state = await loadAppState([key])
  return Array.isArray(state[key]) ? (state[key] as AttachmentMeta[]) : []
}

const toPublic = ({ storagePath: _hidden, ...pub }: AttachmentMeta) => pub

export async function GET(req: NextRequest, { params }: { params: { soId: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const attachments = await listAttachments(params.soId)
  const fileId = new URL(req.url).searchParams.get('file')
  if (!fileId) {
    return NextResponse.json({ attachments: attachments.map(toPublic) })
  }

  const meta = attachments.find(a => a.id === fileId)
  if (!meta) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  try {
    const buffer = await readFile(meta.storagePath)
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': meta.contentType,
        'Content-Disposition': `attachment; filename="${meta.name}"`,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Attachment file is missing' }, { status: 404 })
  }
}

export async function POST(req: NextRequest, { params }: { params: { soId: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let form: FormData
  try { form = await req.formData() } catch {
    return NextResponse.json({ error: 'Invalid upload form' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Attachment file is required' }, { status: 400 })
  if (file.size <= 0) return NextResponse.json({ error: 'Attachment file is empty' }, { status: 400 })
  if (file.size > MAX_ATTACHMENT_BYTES) return NextResponse.json({ error: 'Attachments must be 10 MB or smaller' }, { status: 413 })

  const contentType = file.type || 'application/octet-stream'
  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json({ error: 'Unsupported attachment type. Upload PDF, Word, Excel, CSV, text, JPG, PNG, or WebP.' }, { status: 415 })
  }

  try {
    const id = randomUUID()
    const originalName = safeStem(file.name || 'attachment')
    const ext = path.extname(originalName)
    const dir = path.join(process.cwd(), '.uploads', 'so-attachments', safeStem(params.soId))
    await mkdir(dir, { recursive: true })
    const storagePath = path.join(dir, `${id}${ext || ''}`)
    await writeFile(storagePath, Buffer.from(await file.arrayBuffer()))

    const existing = await listAttachments(params.soId)
    const meta: AttachmentMeta = {
      id,
      name: originalName,
      size: file.size,
      contentType,
      uploadedAt: new Date().toISOString(),
      uploadedBy: session.user.name ?? session.user.username ?? 'User',
      storagePath,
    }
    await saveStoreKeys({ [stateKey(params.soId)]: JSON.stringify([...existing, meta]) })
    return NextResponse.json({ attachment: toPublic(meta) }, { status: 201 })
  } catch (err) {
    console.error('[sale-order-attachments] upload failed:', err)
    return NextResponse.json({ error: 'Attachment upload failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { soId: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const fileId = new URL(req.url).searchParams.get('file')
  if (!fileId) return NextResponse.json({ error: 'file query parameter is required' }, { status: 400 })

  const attachments = await listAttachments(params.soId)
  const meta = attachments.find(a => a.id === fileId)
  if (!meta) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })

  try { await unlink(meta.storagePath) } catch { /* file already gone */ }
  await saveStoreKeys({
    [stateKey(params.soId)]: JSON.stringify(attachments.filter(a => a.id !== fileId)),
  })
  return NextResponse.json({ ok: true })
}
