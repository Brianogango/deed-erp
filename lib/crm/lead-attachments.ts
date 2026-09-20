import 'server-only'
import { randomUUID } from 'crypto'
import path from 'path'
import { getObject, putObject } from '@/lib/infra/object-store'

export type LeadAttachmentMeta = {
  id: string
  name: string
  size: number
  contentType: string
  storedAt: string
  objectKey?: string
}

const MAX_BYTES = 12 * 1024 * 1024

function safeStem(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100) || 'attachment'
}

function leadObjectKey(leadId: string, id: string, name: string) {
  const ext = path.extname(safeStem(name))
  return `lead-attachments/${safeStem(leadId)}/${id}${ext || ''}`
}

/**
 * Persist inbound email attachments for a lead. Returns public metadata (no paths).
 */
export async function storeLeadEmailAttachments(
  leadId: string,
  files: Array<{ filename: string; contentType: string; size: number; content?: Buffer }>,
): Promise<LeadAttachmentMeta[]> {
  if (!files.length) return []
  const out: LeadAttachmentMeta[] = []

  for (const file of files.slice(0, 10)) {
    const buf = file.content
    if (!buf || buf.length <= 0) continue
    if (buf.length > MAX_BYTES) continue
    const id = randomUUID()
    const originalName = safeStem(file.filename || 'attachment')
    const objectKey = leadObjectKey(leadId, id, originalName)
    await putObject({
      bucket: 'uploads',
      key: objectKey,
      body: buf,
      contentType: file.contentType || 'application/octet-stream',
    })
    out.push({
      id,
      name: originalName,
      size: buf.length,
      contentType: file.contentType || 'application/octet-stream',
      storedAt: new Date().toISOString(),
      objectKey,
    })
  }

  return out
}

export async function readLeadAttachmentFile(
  leadId: string,
  meta: LeadAttachmentMeta,
): Promise<Buffer | null> {
  const key = meta.objectKey || leadObjectKey(leadId, meta.id, meta.name)
  const fromStore = await getObject('uploads', key)
  if (fromStore) return fromStore
  try {
    const { readFile } = await import('fs/promises')
    const dir = path.join(process.cwd(), '.uploads', 'lead-attachments', safeStem(leadId))
    const ext = path.extname(meta.name)
    try {
      return await readFile(path.join(dir, `${meta.id}${ext || ''}`))
    } catch {
      return await readFile(path.join(dir, meta.id))
    }
  } catch {
    return null
  }
}
