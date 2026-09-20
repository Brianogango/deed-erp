import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import path from 'path'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { validateFileContent, logRejectedUpload } from '@/lib/file-validation'
import { deleteObject, getObject, putObject } from '@/lib/infra/object-store'

// Quotation / sales-order attachments (Odoo: documents attached to the order).
// Bytes live in the object store (local .uploads by default, S3 when configured).
// Metadata is a JSON array in app_state so every browser sees the same list.

type AttachmentMeta = {
  id: string
  name: string
  size: number
  contentType: string
  uploadedAt: string
  uploadedBy: string
  storagePath: string
  objectKey?: string
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

const toPublic = ({ storagePath: _hidden, objectKey: _objectKey, ...pub }: AttachmentMeta) => pub

function attachmentObjectKey(soId: string, id: string, name: string) {
  const ext = path.extname(safeStem(name))
  return `so-attachments/${safeStem(soId)}/${id}${ext || ''}`
}

async function readAttachmentBytes(soId: string, meta: AttachmentMeta): Promise<Buffer | null> {
  const key = meta.objectKey || attachmentObjectKey(soId, meta.id, meta.name)
  const fromStore = await getObject('uploads', key)
  if (fromStore) return fromStore
  if (meta.storagePath) {
    try {
      const { readFile } = await import('fs/promises')
      return await readFile(meta.storagePath)
    } catch {
      return null
    }
  }
  return null
}

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
  const buffer = await readAttachmentBytes(params.soId, meta)
  if (!buffer) return NextResponse.json({ error: 'Attachment file is missing' }, { status: 404 })
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': meta.contentType,
      'Content-Disposition': `attachment; filename="${meta.name}"`,
    },
  })
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

  const contentType = (file.type || 'application/octet-stream').toLowerCase()
  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json({ error: 'Unsupported attachment type. Upload PDF, Word, Excel, CSV, text, JPG, PNG, or WebP.' }, { status: 415 })
  }

  try {
    const id = randomUUID()
    const originalName = safeStem(file.name || 'attachment')
    const objectKey = attachmentObjectKey(params.soId, id, originalName)
    const buffer = Buffer.from(await file.arrayBuffer())
    const contentCheck = validateFileContent(buffer, contentType)
    if (!contentCheck.ok) {
      logRejectedUpload({
        route: 'sale-order-attachments',
        declaredType: contentType,
        fileName: originalName,
        size: file.size,
        reason: contentCheck.error,
        userId: session.user.id,
      })
      return NextResponse.json({ error: contentCheck.error }, { status: 415 })
    }
    const stored = await putObject({
      bucket: 'uploads',
      key: objectKey,
      body: buffer,
      contentType,
    })

    const existing = await listAttachments(params.soId)
    const meta: AttachmentMeta = {
      id,
      name: originalName,
      size: file.size,
      contentType,
      uploadedAt: new Date().toISOString(),
      uploadedBy: session.user.name ?? session.user.username ?? 'User',
      storagePath: stored.uri,
      objectKey,
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

  try {
    await deleteObject('uploads', meta.objectKey || attachmentObjectKey(params.soId, meta.id, meta.name))
    if (meta.storagePath && !meta.storagePath.startsWith('file://') && !meta.storagePath.startsWith('s3://')) {
      const { unlink } = await import('fs/promises')
      await unlink(meta.storagePath).catch(() => {})
    }
  } catch { /* file already gone */ }
  await saveStoreKeys({
    [stateKey(params.soId)]: JSON.stringify(attachments.filter(a => a.id !== fileId)),
  })
  return NextResponse.json({ ok: true })
}
