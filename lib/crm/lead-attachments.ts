import 'server-only'
import { randomUUID } from 'crypto'
import path from 'path'
import { mkdir, writeFile, readFile } from 'fs/promises'

export type LeadAttachmentMeta = {
  id: string
  name: string
  size: number
  contentType: string
  storedAt: string
}

const MAX_BYTES = 12 * 1024 * 1024

function safeStem(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100) || 'attachment'
}

function leadDir(leadId: string) {
  return path.join(process.cwd(), '.uploads', 'lead-attachments', safeStem(leadId))
}

/**
 * Persist inbound email attachments for a lead. Returns public metadata (no paths).
 */
export async function storeLeadEmailAttachments(
  leadId: string,
  files: Array<{ filename: string; contentType: string; size: number; content?: Buffer }>,
): Promise<LeadAttachmentMeta[]> {
  if (!files.length) return []
  const dir = leadDir(leadId)
  await mkdir(dir, { recursive: true })
  const out: LeadAttachmentMeta[] = []

  for (const file of files.slice(0, 10)) {
    const buf = file.content
    if (!buf || buf.length <= 0) continue
    if (buf.length > MAX_BYTES) continue
    const id = randomUUID()
    const originalName = safeStem(file.filename || 'attachment')
    const ext = path.extname(originalName)
    const storagePath = path.join(dir, `${id}${ext || ''}`)
    await writeFile(storagePath, buf)
    out.push({
      id,
      name: originalName,
      size: buf.length,
      contentType: file.contentType || 'application/octet-stream',
      storedAt: new Date().toISOString(),
    })
  }

  return out
}

export async function readLeadAttachmentFile(
  leadId: string,
  meta: LeadAttachmentMeta,
): Promise<Buffer | null> {
  const dir = leadDir(leadId)
  const ext = path.extname(meta.name)
  const storagePath = path.join(dir, `${meta.id}${ext || ''}`)
  try {
    return await readFile(storagePath)
  } catch {
    // Fallback: try without relying on extension from name
    try {
      return await readFile(path.join(dir, meta.id))
    } catch {
      return null
    }
  }
}
